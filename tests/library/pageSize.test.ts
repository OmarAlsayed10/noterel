import { createHash, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyLibraryFilters } from '../../src/library/searchQuery'

vi.mock('expo-secure-store', () => ({ getItemAsync: async () => '0'.repeat(64) }))
vi.mock('expo-file-system/legacy', () => ({ getInfoAsync: async () => ({ exists: false }) }))
vi.mock('expo-file-system', () => ({ File: function File() {}, Paths: { cache: { uri: 'file:///cache/' } } } ))
vi.mock('../../modules/kestrel-noise', () => ({ default: {} }))
vi.mock('expo-crypto', async () => {
  const crypto = await import('node:crypto')
  return { randomUUID: crypto.randomUUID, CryptoDigestAlgorithm: { SHA256: 'sha256' }, digest: async (_algorithm: string, bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest(), digestStringAsync: async (_algorithm: string, text: string) => crypto.createHash('sha256').update(text).digest('hex') }
})
vi.mock('expo-sqlite', async () => (await import('./databaseFixture')).sqliteBoundary())

beforeEach(() => vi.resetModules())
afterEach(async () => {
  const { openEncryptedDatabase } = await import('../../src/storage/database')
  await (await openEncryptedDatabase()).closeAsync()
})

async function saveMixedLibrary() {
  const { enqueueCapture } = await import('../../src/capture/outbox')
  const { downloadSource } = await import('../../src/library/library')
  const ids: string[] = []
  for (let index = 0; index < 7; index += 1) ids.push((await enqueueCapture({ kind: 'note', title: `Phone ${index}`, text: `Phone note ${index}` })).id)
  for (let index = 0; index < 4; index += 1) {
    const sourceId = randomUUID()
    const text = `Desktop note ${index}`
    const hash = createHash('sha256').update(text).digest('hex')
    const card = { sourceId, kind: 'manual_note', title: `Desktop ${index}`, projectId: null, projectName: null, folderName: null, relativePath: null, url: null, revision: hash, textSha256: hash, byteLength: Buffer.byteLength(text), updatedAt: '2026-10-31T00:00:00.000Z', downloadEligible: true, unavailableReason: null }
    await downloadSource({ mailboxId: 'a'.repeat(22), request: async () => ({ requestId: sourceId, status: 200, body: { ...card, totalBytes: card.byteLength, offset: 0, nextOffset: null, bytes: Buffer.from(text).toString('base64url') } }) }, card)
    ids.push(sourceId)
  }
  return ids
}

describe('combined library page size', () => {
  it.each([5, 10, 20])('returns at most %s phone and downloaded notes together without omissions', async pageSize => {
    const expectedIds = await saveMixedLibrary()
    const { loadLocalLibrary } = await import('../../src/features/library/loadLocalLibrary')
    const visibleIds: string[] = []
    for (let page = 0; page < Math.ceil(expectedIds.length / pageSize); page += 1) {
      const listing = await loadLocalLibrary({ query: '', page, pageSize, scope: 'all', desktopSourceIds: [], filters: emptyLibraryFilters() })
      const pageIds = [...listing.captures.map(capture => capture.id), ...listing.visibleDownloads.map(download => download.sourceId)]
      expect(pageIds.length).toBeLessThanOrEqual(pageSize)
      expect(listing.phoneTotal + listing.downloadedTotal).toBe(expectedIds.length)
      visibleIds.push(...pageIds)
    }
    expect(visibleIds.sort()).toEqual(expectedIds.sort())
  })
})
