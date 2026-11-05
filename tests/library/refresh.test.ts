import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileResponse } from '../../src/companion/protocol'
import { emptyLearningDetails } from '../../src/learning/schema'

vi.mock('expo-secure-store', () => ({ getItemAsync: async () => '0'.repeat(64) }))
vi.mock('expo-file-system/legacy', () => ({ getInfoAsync: async () => ({ exists: false }) }))
vi.mock('expo-crypto', async () => {
  const { createHash, randomUUID } = await import('node:crypto')
  return { randomUUID, CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async (_algorithm: string, text: string) => createHash('sha256').update(text).digest('hex') }
})
vi.mock('expo-sqlite', async () => (await import('./databaseFixture')).sqliteBoundary())

const sourceId = '00000000-0000-4000-8000-000000000001'
const cachedId = '00000000-0000-4000-8000-000000000002'
const mailboxId = 'a'.repeat(22)
const timestamp = '2026-10-31T10:00:00.000Z'
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const card = (text: string) => ({ sourceId: cachedId, kind: 'manual_note' as const, title: 'Cached note', projectId: null, projectName: null, folderName: null, relativePath: null, url: null, revision: sha256(`revision:${text}`), textSha256: sha256(text), byteLength: Buffer.byteLength(text), updatedAt: timestamp, downloadEligible: true, unavailableReason: null })
const page = (text: string) => ({ ...card(text), totalBytes: Buffer.byteLength(text), offset: 0, nextOffset: null, bytes: Buffer.from(text).toString('base64url') })
const response = (body: unknown, status = 200): MobileResponse => ({ requestId: sourceId, status, body })
const emptyPersonalNotes = (path: string): MobileResponse => response({ sourceId: path.split('/').at(-1), revision: 0, details: emptyLearningDetails() })
const modules = async () => ({ ...await import('../../src/features/library/refreshDesktopLibrary'), ...await import('../../src/library/library'), ...await import('../../src/notes/pendingEdits') })
const draft = { sourceId, destinationMailboxId: mailboxId, title: 'My draft', text: 'Keep my changes', projectId: null, expectedUpdatedAt: timestamp }

beforeEach(() => vi.resetModules())
afterEach(async () => {
  const { openEncryptedDatabase } = await import('../../src/storage/database')
  await (await openEncryptedDatabase()).closeAsync()
})

describe('independent library refresh work', () => {
  it.each([[0, 1, 0, 0], [1, 3, 0, 3], [2, 5, 3, 5]])('fills combined page %s after phone notes with the correct Desktop window', async (pageIndex, expectedLimit, expectedOffset, expectedVisible) => {
    const library = await modules()
    const requestedWindows: { limit: number; offset: number }[] = []
    const connection = { mailboxId, close: () => {}, request: async (request: { path: string }) => {
      if (request.path.includes('/companion/learning/')) return emptyPersonalNotes(request.path)
      const parameters = new URL(request.path, 'https://desktop.invalid').searchParams
      const limit = Number(parameters.get('limit'))
      const offset = Number(parameters.get('offset') ?? 0)
      requestedWindows.push({ limit, offset })
      return response({ items: Array.from({ length: limit }, () => card('Listed note')), totalItems: 20, nextCursor: null })
    } }
    const refreshed = await library.refreshDesktopLibrary({ connection, query: '', page: pageIndex, pageSize: 5, phoneTotal: 7, scope: 'all', isCurrent: () => true, publishListing: () => {} })
    expect(requestedWindows).toEqual([{ limit: expectedLimit, offset: expectedOffset }])
    expect(refreshed?.listing.items).toHaveLength(expectedVisible)
    expect(refreshed?.listing.totalItems).toBe(20)
  })

  it('preserves an accepted phone original when its job fails to respond while other notes finish syncing', async () => {
    const library = await modules()
    const { enqueueCapture, assignQueuedCapture } = await import('../../src/capture/outbox')
    const { drainCaptureOutbox } = await import('../../src/capture/drainOutbox')
    const { phoneMemoryPage } = await import('../../src/library/phoneMemories')
    const capture = await enqueueCapture({ kind: 'note', title: 'Phone original', text: 'Keep this phone original' })
    await assignQueuedCapture(capture.id, mailboxId)
    await drainCaptureOutbox({ mailboxId, request: async () => response({ sourceId: '00000000-0000-4000-8000-000000000003', jobId: '00000000-0000-4000-8000-000000000004', outcome: 'accepted' }, 202) })
    await library.queueDesktopEdit(draft)
    await library.downloadSource({ mailboxId, request: async () => response(page('Old cached text')) }, card('Old cached text'))
    const savedDraft = { ...card(draft.text), sourceId, title: draft.title }
    const connection = { mailboxId, close: () => {}, request: async (request: { method: string; path: string; body: unknown }) => {
      if (request.path.includes('/companion/learning/')) return emptyPersonalNotes(request.path)
      if (request.path.includes('/jobs/')) return response({}, 503)
      if (request.method === 'PUT') return response({ sourceId, jobId: null, outcome: 'updated' })
      if (request.path.includes('/library?')) return response({ items: [savedDraft, card('Latest cached text')], totalItems: 2, nextCursor: null })
      if (request.path.endsWith('/check')) return response((request.body as { sources: { sourceId: string; revision: string }[] }).sources.map(source => {
        const current = source.sourceId === sourceId ? savedDraft : card('Latest cached text')
        return { sourceId: source.sourceId, state: source.revision === current.revision ? 'unchanged' : 'changed', revision: current.revision }
      }))
      return response(request.path.includes(`/library/${sourceId}?`) ? { ...page(draft.text), ...savedDraft } : page('Latest cached text'))
    } }
    const refreshed = await library.refreshDesktopLibrary({ connection, query: '', page: 0, scope: 'all', isCurrent: () => true, publishListing: () => {} })
    expect(refreshed?.failures).toHaveLength(1)
    expect(await library.pendingDesktopEdits()).toEqual([])
    expect((await library.readDownloadedSource(sourceId))?.text).toBe(draft.text)
    expect((await library.readDownloadedSource(cachedId))?.text).toBe('Latest cached text')
    expect(await phoneMemoryPage()).toMatchObject([{ type: 'capture', capture: { id: capture.id, payload: { text: 'Keep this phone original' } } }])
  })

  it.each([false, true])('updates an offline copy after a queued edit fails, with relisting failure %s', async relistingFails => {
    const library = await modules()
    await library.downloadSource({ mailboxId, request: async () => response(page('Old cached text')) }, card('Old cached text'))
    await library.queueDesktopEdit(draft)
    let listings = 0
    const connection = { mailboxId, close: () => {}, request: async (request: { method: string; path: string }) => {
      if (request.path.includes('/companion/learning/')) return emptyPersonalNotes(request.path)
      if (request.method === 'PUT') return response({}, 503)
      if (request.path.includes('/library?')) {
        listings += 1
        return relistingFails && listings > 1 ? response({}, 503) : response({ items: [card('Latest cached text')], totalItems: 1, nextCursor: null })
      }
      return request.path.endsWith('/check') ? response([{ sourceId: cachedId, state: 'changed', revision: card('Latest cached text').revision }]) : response(page('Latest cached text'))
    } }
    const visibleListings: unknown[] = []
    const refreshed = await library.refreshDesktopLibrary({ connection, query: 'cached', page: 0, scope: 'all', isCurrent: () => true, publishListing: listing => visibleListings.push(listing) })
    expect(refreshed?.failures).toHaveLength(relistingFails ? 2 : 1)
    expect(refreshed?.listing.items).toEqual([card('Latest cached text')])
    expect(visibleListings[0]).toMatchObject({ items: [card('Latest cached text')] })
    expect((await library.readDownloadedSource(cachedId))?.text).toBe('Latest cached text')
    expect(await library.pendingDesktopEdits()).toMatchObject([{ text: draft.text, state: 'queued' }])
  })

  it('keeps a successful listing and readable offline text when its update cannot download', async () => {
    const library = await modules()
    await library.downloadSource({ mailboxId, request: async () => response(page('Readable offline text')) }, card('Readable offline text'))
    const published: unknown[] = []
    const connection = { mailboxId, close: () => {}, request: async (request: { path: string }) => {
      if (request.path.includes('/companion/learning/')) return emptyPersonalNotes(request.path)
      if (request.path.includes('/library?')) return response({ items: [card('New text')], totalItems: 1, nextCursor: null })
      return request.path.endsWith('/check') ? response([{ sourceId: cachedId, state: 'changed', revision: card('New text').revision }]) : response({}, 503)
    } }
    const refreshed = await library.refreshDesktopLibrary({ connection, query: '', page: 0, scope: 'all', isCurrent: () => true, publishListing: listing => published.push(listing) })
    expect(refreshed?.failures).toHaveLength(1)
    expect(refreshed?.listing.items).toEqual([card('New text')])
    expect(published[0]).toMatchObject({ totalItems: 1 })
    expect(await library.readDownloadedSource(cachedId)).toMatchObject({ text: 'Readable offline text', stale: true })
  })

  it.each(['before-listing', 'after-listing'] as const)('stops obsolete refreshes %s without sending queued edits', async cancellation => {
    const library = await modules()
    await library.queueDesktopEdit(draft)
    let current = cancellation !== 'before-listing'
    const request = vi.fn(async () => response({ items: [], totalItems: 0, nextCursor: null }))
    const refreshed = await library.refreshDesktopLibrary({ connection: { mailboxId, request, close: () => {} }, query: '', page: 0, scope: 'all', isCurrent: () => current, publishListing: () => { current = false } })
    expect(refreshed).toBeNull()
    expect(request).toHaveBeenCalledTimes(cancellation === 'before-listing' ? 0 : 1)
    expect(await library.pendingDesktopEdits()).toMatchObject([{ text: draft.text, state: 'queued' }])
  })
})
