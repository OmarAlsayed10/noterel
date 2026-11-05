import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileResponse } from '../../src/companion/protocol'

vi.mock('expo-secure-store', () => ({ getItemAsync: async () => '0'.repeat(64) }))
vi.mock('expo-file-system/legacy', () => ({ getInfoAsync: async () => ({ exists: false }) }))
vi.mock('expo-crypto', async () => {
  const { createHash, randomUUID } = await import('node:crypto')
  return { randomUUID, CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async (_algorithm: string, text: string) => createHash('sha256').update(text).digest('hex') }
})
vi.mock('expo-sqlite', async () => (await import('./databaseFixture')).sqliteBoundary())

const sourceId = '00000000-0000-4000-8000-000000000001'
const replacementId = '00000000-0000-4000-8000-000000000002'
const jobId = '00000000-0000-4000-8000-000000000003'
const mailboxId = 'a'.repeat(22)
const timestamp = '2026-10-23T10:00:00.000Z'
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const card = (id: string, text: string) => ({ sourceId: id, kind: 'manual_note' as const, title: 'Note', projectId: null, projectName: null, folderName: null, relativePath: null, url: null, revision: sha256(`${id}:${text}`), textSha256: sha256(text), byteLength: Buffer.byteLength(text), updatedAt: timestamp, downloadEligible: true, unavailableReason: null })
const page = (source: ReturnType<typeof card>, text: string, offset = 0) => {
  const bytes = Buffer.from(text).subarray(offset, offset + 24 * 1024)
  return { ...source, totalBytes: source.byteLength, offset, nextOffset: offset + bytes.length === source.byteLength ? null : offset + bytes.length, bytes: bytes.toString('base64url') }
}
const response = (body: unknown, status = 200): MobileResponse => ({ requestId: jobId, status, body })
const edit = (text = 'Phone edit') => ({ sourceId, destinationMailboxId: mailboxId, title: 'Note', text, projectId: null, expectedUpdatedAt: timestamp })
const modules = async () => ({ ...await import('../../src/library/library'), ...await import('../../src/notes/pendingEdits'), ...await import('../../src/storage/database') })

beforeEach(() => vi.resetModules())
afterEach(async () => { vi.restoreAllMocks(); const { openEncryptedDatabase } = await import('../../src/storage/database'); await (await openEncryptedDatabase()).closeAsync() })

describe('desktop and phone note synchronization regressions', () => {
  it.each([mailboxId, null])('keeps a draft from origin %s private after pairing to another Desktop', async origin => {
    const library = await modules()
    await library.queueDesktopEdit({ ...edit(), destinationMailboxId: origin })
    const requester = { mailboxId: 'b'.repeat(22), request: vi.fn(async () => { throw new Error('A foreign draft must never reach this Desktop') }) }
    await library.syncDesktopEdits(requester)
    expect(requester.request).not.toHaveBeenCalled()
    expect(await library.pendingDesktopEdits()).toMatchObject([{ text: 'Phone edit', destinationMailboxId: origin, state: 'conflict' }])
  })

  it('keeps downloaded-note origin when an old Desktop note is edited under a new pairing', async () => {
    const library = await modules()
    const original = card(sourceId, 'Private Desktop A text')
    await library.downloadSource({ mailboxId, request: async () => response(page(original, 'Private Desktop A text')) }, original)
    await library.queueDesktopEdit({ ...edit(), destinationMailboxId: 'b'.repeat(22) })
    const requester = { mailboxId: 'b'.repeat(22), request: vi.fn(async () => { throw new Error('Foreign cache and edit must remain local') }) }
    await library.syncDesktopEdits(requester)
    await library.reconcileDownloads(requester)
    expect(requester.request).not.toHaveBeenCalled()
    expect(await library.pendingDesktopEdits()).toMatchObject([{ destinationMailboxId: mailboxId, text: 'Phone edit', state: 'conflict' }])
    expect((await library.readDownloadedSource(sourceId))?.text).toBe('Private Desktop A text')
    expect(await library.localLibraryByIds([sourceId], requester.mailboxId)).toEqual([])
  })

  it('preserves an existing draft origin even when the same source ID is downloaded from another Desktop', async () => {
    const library = await modules()
    await library.queueDesktopEdit(edit())
    const original = card(sourceId, 'Restored Desktop B copy')
    await library.downloadSource({ mailboxId: 'b'.repeat(22), request: async () => response(page(original, 'Restored Desktop B copy')) }, original)
    await library.queueDesktopEdit({ ...edit('Still Desktop A draft'), destinationMailboxId: 'b'.repeat(22) })
    const foreign = { mailboxId: 'b'.repeat(22), request: vi.fn(async () => { throw new Error('Known draft ownership must not be replaced by cache ownership') }) }
    await library.syncDesktopEdits(foreign)
    expect(foreign.request).not.toHaveBeenCalled()
    expect(await library.pendingDesktopEdits()).toMatchObject([{ destinationMailboxId: mailboxId, text: 'Still Desktop A draft', state: 'conflict' }])
  })

  it('keeps legacy unbound cached notes readable without assigning a new Desktop as their owner', async () => {
    const library = await modules()
    const original = card(sourceId, 'Legacy private text')
    await library.downloadSource({ mailboxId, request: async () => response(page(original, 'Legacy private text')) }, original)
    const database = await library.openEncryptedDatabase()
    await database.runAsync('UPDATE downloaded_sources SET mailbox_id=NULL WHERE source_id=?', sourceId)
    await library.queueDesktopEdit({ ...edit(), destinationMailboxId: 'b'.repeat(22) })
    const requester = { mailboxId: 'b'.repeat(22), request: vi.fn(async () => { throw new Error('Unbound notes must never be sent') }) }
    await library.syncDesktopEdits(requester)
    await library.reconcileDownloads(requester)
    expect(requester.request).not.toHaveBeenCalled()
    expect(await library.pendingDesktopEdits()).toMatchObject([{ destinationMailboxId: null, state: 'conflict', text: 'Phone edit' }])
    expect((await library.readDownloadedSource(sourceId))?.text).toBe('Legacy private text')
  })

  it('preserves Arabic conflict copy text while bounding its title and flagging oversized serialized copies', async () => {
    const { conflictPhoneCopy, conflictCopyTooLarge } = await import('../../src/notes/conflictCopy')
    const note = { title: 'عنوان'.repeat(51), text: 'النص الأصلي' }
    const copy = conflictPhoneCopy(note)
    expect(Buffer.byteLength(copy.title!)).toBeLessThanOrEqual(512)
    expect(copy.title).toMatch(/ \(phone copy\)$/)
    expect(copy.text).toBe(note.text)
    expect(conflictCopyTooLarge({ title: 'Note', text: '"'.repeat(600_000) })).toBe(true)
  })

  it('keeps an accepted phone note readable when Desktop ingestion fails and never sends unassigned notes', async () => {
    const library = await modules()
    const { enqueueCapture, assignQueuedCapture } = await import('../../src/capture/outbox')
    const { drainCaptureOutbox } = await import('../../src/capture/drainOutbox')
    const { linkedPhoneNote, reconcileDeliveredNotes } = await import('../../src/capture/linkedNotes')
    const { phoneMemoryPage } = await import('../../src/library/phoneMemories')
    const capture = await enqueueCapture({ kind: 'note', title: 'Note', text: 'Phone original' })
    let jobState = 'queued'
    const requester = { mailboxId, request: vi.fn(async (request: { method: string }) => request.method === 'POST' ? response({ sourceId, jobId, outcome: 'accepted' }, 202) : response({ state: jobState })) }
    await drainCaptureOutbox(requester)
    expect(requester.request).not.toHaveBeenCalled()
    await assignQueuedCapture(capture.id, mailboxId)
    await drainCaptureOutbox(requester)
    expect(await linkedPhoneNote(capture.id)).toEqual({ sourceId, mailboxId })
    const foreign = { mailboxId: 'b'.repeat(22), request: vi.fn(async () => { throw new Error('Accepted notes must stay with the selected Desktop') }) }
    await reconcileDeliveredNotes(foreign)
    expect(foreign.request).not.toHaveBeenCalled()
    await reconcileDeliveredNotes(requester)
    expect(await linkedPhoneNote(capture.id)).toEqual({ sourceId, mailboxId })
    expect(await phoneMemoryPage()).toMatchObject([{ type: 'capture', capture: { payload: { text: 'Phone original' } } }])
    jobState = 'failed'
    await reconcileDeliveredNotes(requester)
    expect(await linkedPhoneNote(capture.id)).toBeNull()
    expect(await phoneMemoryPage()).toMatchObject([{ type: 'capture', capture: { payload: { text: 'Phone original' }, destinationMailboxId: null } }])
    expect(await library.readDownloadedSource(sourceId)).toBeNull()
  })

  it.each([false, true])('retains edits during phone delivery with lost acknowledgment %s and follows later Desktop edits', async lostAcknowledgment => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const library = await modules()
    const { enqueueCapture, assignQueuedCapture, updateQueuedCapture } = await import('../../src/capture/outbox')
    const { drainCaptureOutbox } = await import('../../src/capture/drainOutbox')
    const { reconcileDeliveredNotes } = await import('../../src/capture/linkedNotes')
    const { phoneMemoryPage, phoneMemoryCount } = await import('../../src/library/phoneMemories')
    const capture = await enqueueCapture({ kind: 'note', title: 'Note', text: 'Phone original' })
    await assignQueuedCapture(capture.id, mailboxId)
    const original = card(sourceId, 'Phone original')
    const phoneEdited = card(replacementId, 'Phone edit during delivery')
    const desktopEdited = card(jobId, 'Desktop changed the phone note')
    let creations = 0
    const creationKeys = new Set<string>()
    let desktopAdvanced = false
    const requester = { mailboxId, request: async (request: { method: string; path: string; body: unknown }) => {
      if (request.path === '/api/v1/sources') {
        const key = (request.body as { idempotencyKey: string }).idempotencyKey
        if (!creationKeys.has(key)) {
          creationKeys.add(key)
          creations += 1
          await updateQueuedCapture(capture.id, { kind: 'note', title: 'Note', text: 'Phone edit during delivery' })
          if (lostAcknowledgment) throw new Error('Accepted create acknowledgment lost')
        }
        return response({ sourceId, jobId, outcome: 'accepted' }, 202)
      }
      if (request.method === 'PUT') return response({ sourceId: replacementId, jobId, outcome: 'replacement_pending' }, 202)
      if (request.path.includes('/jobs/')) return response({ state: 'succeeded' })
      if (request.path.endsWith('/check')) {
        const id = (request.body as { sources: { sourceId: string }[] }).sources[0].sourceId
        if (desktopAdvanced && id === replacementId) return response([{ sourceId: replacementId, state: 'replaced', replacement: { sourceId: jobId, revision: desktopEdited.revision } }])
        const current = id === sourceId ? original : id === replacementId ? phoneEdited : desktopEdited
        return response([{ sourceId: id, state: 'changed', revision: current.revision }])
      }
      const current = request.path.includes(sourceId) ? original : request.path.includes(replacementId) ? phoneEdited : desktopEdited
      const text = current === original ? 'Phone original' : current === phoneEdited ? 'Phone edit during delivery' : 'Desktop changed the phone note'
      return response(page(current, text))
    } }
    await drainCaptureOutbox(requester)
    expect(await phoneMemoryPage()).toMatchObject([{ type: 'capture', capture: { payload: { text: 'Phone edit during delivery' } } }])
    if (lostAcknowledgment) {
      const database = await library.openEncryptedDatabase()
      expect(await database.getAllAsync('SELECT payload_json FROM outbox_operations')).toMatchObject([{ payload_json: JSON.stringify({ kind: 'note', title: 'Note', text: 'Phone original' }) }])
      clock.mockReturnValue(4000)
      await drainCaptureOutbox(requester)
    }
    await reconcileDeliveredNotes(requester)
    expect(await phoneMemoryCount()).toBe(0)
    const database = await library.openEncryptedDatabase()
    const receipt = await database.getFirstAsync<{ response_json: string }>('SELECT response_json FROM delivery_receipts WHERE id=?', capture.id)
    expect(JSON.parse(receipt!.response_json)).not.toHaveProperty('phonePayload')
    expect(await library.pendingDesktopEdits()).toMatchObject([{ text: 'Phone edit during delivery', destinationMailboxId: mailboxId, state: 'queued' }])
    await library.syncDesktopEdits(requester)
    expect((await library.readDownloadedSource(replacementId))?.text).toBe('Phone edit during delivery')
    expect(creations).toBe(1)
    desktopAdvanced = true
    await library.reconcileDownloads(requester)
    expect(await library.readDownloadedSource(replacementId)).toBeNull()
    expect((await library.readDownloadedSource(jobId))?.text).toBe('Desktop changed the phone note')
    expect(await phoneMemoryCount()).toBe(0)
  })

  it('resumes initial large phone-note creation with its original operation key after a lost commit acknowledgment', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const library = await modules()
    const { enqueueCapture, assignQueuedCapture } = await import('../../src/capture/outbox')
    const { drainCaptureOutbox } = await import('../../src/capture/drainOutbox')
    const text = 'ملاحظة "عربية"\n'.repeat(6000)
    const capture = await enqueueCapture({ kind: 'note', title: null, text })
    await assignQueuedCapture(capture.id, mailboxId)
    const database = await library.openEncryptedDatabase()
    const originalOperation = await database.getFirstAsync<{ operation_key: string }>('SELECT operation_key FROM outbox_operations WHERE id=?', capture.id)
    let uploaded = Buffer.alloc(0)
    let interrupted = false
    const starts: string[] = []
    const requester = { mailboxId, request: async (request: { method: string; path: string; body: unknown }) => {
      if (request.method === 'PUT') {
        starts.push(request.path)
        expect(request.body).toMatchObject({ sourceId: null, expectedUpdatedAt: null, title: '', idempotencyKey: originalOperation!.operation_key })
        return response({ nextOffset: uploaded.length, totalBytes: Buffer.byteLength(text) })
      }
      if (request.path.endsWith('/chunks')) {
        const chunk = request.body as { offset: number; bytes: string }
        expect(chunk.offset).toBe(uploaded.length)
        uploaded = Buffer.concat([uploaded, Buffer.from(chunk.bytes, 'base64url')])
        return response({ nextOffset: uploaded.length, totalBytes: Buffer.byteLength(text) })
      }
      expect(request.path).toMatch(/\/commit$/)
      if (!interrupted) { interrupted = true; throw new Error('Create commit acknowledgment lost') }
      return response({ sourceId, jobId, outcome: 'accepted' })
    } }
    await drainCaptureOutbox(requester)
    expect((await database.getFirstAsync<{ operation_key: string }>('SELECT operation_key FROM outbox_operations WHERE id=?', capture.id))?.operation_key).toBe(originalOperation!.operation_key)
    clock.mockReturnValue(4000)
    await drainCaptureOutbox(requester)
    expect(starts).toHaveLength(2)
    expect(starts[0]).toBe(starts[1])
    expect(uploaded.toString('utf8')).toBe(text)
    expect(await database.getAllAsync('SELECT id FROM outbox_operations')).toEqual([])
    expect((await database.getFirstAsync<{ payload_json: string }>('SELECT payload_json FROM local_notes WHERE id=?', capture.id))?.payload_json).toContain('ملاحظة')
  })

  it('does not recreate hidden note text when the phone copy is discarded before the delivery acknowledgment arrives', async () => {
    const library = await modules()
    const { enqueueCapture, assignQueuedCapture, discardQueuedCapture } = await import('../../src/capture/outbox')
    const { drainCaptureOutbox } = await import('../../src/capture/drainOutbox')
    const capture = await enqueueCapture({ kind: 'note', title: 'Note', text: 'Discarded private text' })
    await assignQueuedCapture(capture.id, mailboxId)
    await drainCaptureOutbox({ mailboxId, request: async () => { await discardQueuedCapture(capture.id); return response({ sourceId, jobId, outcome: 'accepted' }, 202) } })
    const database = await library.openEncryptedDatabase()
    expect(await database.getAllAsync('SELECT id FROM local_notes')).toEqual([])
    const receipt = await database.getFirstAsync<{ response_json: string }>('SELECT response_json FROM delivery_receipts WHERE id=?', capture.id)
    expect(receipt!.response_json).not.toContain('Discarded private text')
    expect(JSON.parse(receipt!.response_json)).not.toHaveProperty('phonePayload')
  })

  it('keeps the durable edit while Desktop is still processing and only finishes after the note is readable', async () => {
    const library = await modules()
    const updated = card(replacementId, 'Phone edit')
    let finishJob!: (reply: MobileResponse) => void
    let jobStarted!: () => void
    const started = new Promise<void>(resolve => { jobStarted = resolve })
    const job = new Promise<MobileResponse>(resolve => { finishJob = resolve })
    const requester = { mailboxId, request: async (request: { method: string; path: string }) => {
      if (request.method === 'PUT') return response({ sourceId: replacementId, jobId, outcome: 'replacement_pending' }, 202)
      if (request.path.includes('/jobs/')) { jobStarted(); return job }
      if (request.path.endsWith('/check')) return response([{ sourceId: replacementId, state: 'changed', revision: updated.revision }])
      return response(page(updated, 'Phone edit'))
    } }
    await library.queueDesktopEdit(edit())
    const syncing = library.syncDesktopEdits(requester)
    await started
    expect(await library.pendingDesktopEdits()).toMatchObject([{ ...edit(), state: 'queued' }])
    expect(await library.readDownloadedSource(replacementId)).toBeNull()
    finishJob(response({ state: 'succeeded' }))
    await syncing
    expect(await library.pendingDesktopEdits()).toEqual([])
    expect((await library.readDownloadedSource(replacementId))?.text).toBe('Phone edit')
  })

  it('keeps an accepted edit through a lost job response and retries the same operation before replacing its offline copy', async () => {
    const library = await modules()
    const updated = card(replacementId, 'Phone edit')
    const keys: unknown[] = []
    let interrupted = true
    const requester = { mailboxId, request: vi.fn(async (request: { method: string; path: string; body: unknown }) => {
      if (request.method === 'PUT') { keys.push((request.body as { idempotencyKey: string }).idempotencyKey); return response({ sourceId: replacementId, jobId, outcome: 'replacement_pending' }, 202) }
      if (request.path.includes('/jobs/')) { if (interrupted) throw new Error('Connection lost'); return response({ state: 'succeeded' }) }
      if (request.path.endsWith('/check')) return response([{ sourceId: replacementId, state: 'changed', revision: updated.revision }])
      return response(page(updated, 'Phone edit'))
    }) }
    await library.queueDesktopEdit(edit())
    await expect(library.syncDesktopEdits(requester)).rejects.toThrow('Connection lost')
    expect(await library.pendingDesktopEdits()).toMatchObject([{ ...edit(), state: 'queued' }])
    interrupted = false
    await library.queueDesktopEdit(edit())
    await library.syncDesktopEdits(requester)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
    expect(await library.pendingDesktopEdits()).toEqual([])
    expect((await library.readDownloadedSource(replacementId))?.text).toBe('Phone edit')
  })

  it.each(['failed', 'cancelled', 'conflict'])('preserves the phone version for explicit resolution when Desktop reports %s', async failure => {
    const library = await modules()
    const requester = { mailboxId, request: async (request: { method: string }) => request.method === 'PUT' ? response({ sourceId: replacementId, jobId, outcome: 'replacement_pending' }, failure === 'conflict' ? 409 : 202) : response({ state: failure }) }
    await library.queueDesktopEdit(edit())
    await library.syncDesktopEdits(requester)
    expect(await library.pendingDesktopEdits()).toMatchObject([{ ...edit(), state: 'conflict' }])
  })

  it('does not remove a newer phone draft that was saved while the previous edit was downloading', async () => {
    const library = await modules()
    const updated = card(replacementId, 'Phone edit')
    let pageRequests = 0
    const requester = { mailboxId, request: async (request: { method: string; path: string }) => {
      if (request.method === 'PUT') return response({ sourceId: replacementId, jobId: null, outcome: 'updated' })
      if (request.path.endsWith('/check')) return response([{ sourceId: replacementId, state: 'changed', revision: updated.revision }])
      pageRequests += 1
      if (pageRequests === 2) await library.queueDesktopEdit(edit('Newer phone draft'))
      return response(page(updated, 'Phone edit'))
    } }
    await library.queueDesktopEdit(edit())
    await library.syncDesktopEdits(requester)
    expect(await library.pendingDesktopEdits()).toMatchObject([{ ...edit('Newer phone draft'), state: 'queued' }])
  })

  it('starts a new operation when the owner retries identical text after a cancelled save', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const library = await modules()
    const updated = card(replacementId, 'Phone edit')
    const keys: string[] = []
    let retrying = false
    const requester = { mailboxId, request: async (request: { method: string; path: string; body: unknown }) => {
      if (request.method === 'PUT') { keys.push((request.body as { idempotencyKey: string }).idempotencyKey); return response({ sourceId: replacementId, jobId, outcome: 'replacement_pending' }, 202) }
      if (request.path.includes('/jobs/')) return response({ state: retrying ? 'succeeded' : 'cancelled' })
      if (request.path.endsWith('/check')) return response([{ sourceId: replacementId, state: 'changed', revision: updated.revision }])
      return response(page(updated, 'Phone edit'))
    } }
    await library.queueDesktopEdit(edit())
    await library.syncDesktopEdits(requester)
    expect((await library.pendingDesktopEdits())[0].state).toBe('conflict')
    retrying = true
    await library.queueDesktopEdit(edit())
    await library.syncDesktopEdits(requester)
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
    expect(await library.pendingDesktopEdits()).toEqual([])
    expect((await library.readDownloadedSource(replacementId))?.text).toBe('Phone edit')
  })

  it.each(['chunk', 'commit'])('resumes a long Arabic note after a lost %s acknowledgment without repeating accepted bytes', async interruptedStage => {
    const library = await modules()
    const text = 'مرحبا "نص عربي"\n'.repeat(6000)
    const updated = card(replacementId, text)
    const startOffsets: number[] = []
    let uploaded = Buffer.alloc(0)
    let interrupted = false
    const requester = { mailboxId, request: async (request: { method: string; path: string; body: unknown }) => {
      if (request.path.includes('/note-edits/')) {
        if (request.method === 'PUT') {
          expect((request.body as { totalBytes: number; textSha256: string }).textSha256).toBe(sha256(text))
          startOffsets.push(uploaded.length)
          return response({ nextOffset: uploaded.length, totalBytes: Buffer.byteLength(text) })
        }
        if (request.path.endsWith('/chunks')) {
          const chunk = request.body as { offset: number; bytes: string }
          expect(chunk.offset).toBe(uploaded.length)
          const bytes = Buffer.from(chunk.bytes, 'base64url')
          expect(bytes.length).toBeLessThanOrEqual(24 * 1024)
          uploaded = Buffer.concat([uploaded, bytes])
          if (interruptedStage === 'chunk' && !interrupted) { interrupted = true; throw new Error('Acknowledgment lost') }
          return response({ nextOffset: uploaded.length, totalBytes: Buffer.byteLength(text) })
        }
        expect(uploaded.toString('utf8')).toBe(text)
        if (interruptedStage === 'commit' && !interrupted) { interrupted = true; throw new Error('Acknowledgment lost') }
        return response({ sourceId: replacementId, jobId, outcome: 'replacement_pending' }, 202)
      }
      if (request.path.includes('/jobs/')) return response({ state: 'succeeded' })
      if (request.path.endsWith('/check')) return response([{ sourceId: replacementId, state: 'changed', revision: updated.revision }])
      const offset = Number(new URL(request.path, 'https://desktop.invalid').searchParams.get('offset'))
      return response(page(updated, text, offset))
    } }
    await library.queueDesktopEdit(edit(text))
    await expect(library.syncDesktopEdits(requester)).rejects.toThrow('Acknowledgment lost')
    expect((await library.pendingDesktopEdits())[0]).toMatchObject({ text, state: 'queued', tooLarge: false })
    await library.syncDesktopEdits(requester)
    expect(startOffsets).toEqual([0, interruptedStage === 'chunk' ? 24 * 1024 : Buffer.byteLength(text)])
    expect(await library.pendingDesktopEdits()).toEqual([])
    expect((await library.readDownloadedSource(replacementId))?.text).toBe(text)
  })

  it('preserves an unsupported oversized draft for action while a different note still syncs', async () => {
    const library = await modules()
    const oversized = 'أ'.repeat(512 * 1024 + 1)
    const updated = card(jobId, 'Phone edit')
    const requester = { mailboxId, request: async (request: { method: string; path: string; body: unknown }) => {
      if (request.method === 'PUT') { expect(request.path).not.toContain(sourceId); return response({ sourceId: jobId, jobId: null, outcome: 'updated' }) }
      if (request.path.endsWith('/check')) return response([{ sourceId: jobId, state: 'changed', revision: updated.revision }])
      return response(page(updated, 'Phone edit'))
    } }
    await library.queueDesktopEdit(edit(oversized))
    await library.queueDesktopEdit({ ...edit(), sourceId: replacementId })
    await library.syncDesktopEdits(requester)
    expect(await library.pendingDesktopEdits()).toMatchObject([{ sourceId, text: oversized, state: 'conflict', tooLarge: true }])
    expect((await library.readDownloadedSource(jobId))?.text).toBe('Phone edit')
  })

  it('retains readable old text when a replacement transfer fails and migrates it after verified retry', async () => {
    const library = await modules()
    const original = card(sourceId, 'Desktop original')
    const updated = card(replacementId, 'Desktop update')
    await library.downloadSource({ mailboxId, request: async () => response(page(original, 'Desktop original')) }, original)
    let interrupted = true
    const requester = { mailboxId, request: async (request: { path: string; body: unknown }) => {
      if (request.path.endsWith('/check')) {
        const id = (request.body as { sources: { sourceId: string }[] }).sources[0].sourceId
        return response([id === sourceId ? { sourceId, state: 'replaced', replacement: { sourceId: replacementId, revision: updated.revision } } : { sourceId: replacementId, state: 'changed', revision: updated.revision }])
      }
      if (interrupted) throw new Error('Download interrupted')
      return response(page(updated, 'Desktop update'))
    } }
    await expect(library.reconcileDownloads(requester)).rejects.toThrow('Download interrupted')
    expect((await library.readDownloadedSource(sourceId))?.text).toBe('Desktop original')
    interrupted = false
    await library.reconcileDownloads(requester)
    expect(await library.readDownloadedSource(sourceId)).toBeNull()
    expect((await library.readDownloadedSource(replacementId))?.text).toBe('Desktop update')
  })

  it('refreshes changed content without discarding the offline copy when verification fails', async () => {
    const library = await modules()
    const original = card(sourceId, 'Original')
    const updated = card(sourceId, 'Modified')
    await library.downloadSource({ mailboxId, request: async () => response(page(original, 'Original')) }, original)
    const requester = { mailboxId, request: async (request: { path: string }) => request.path.endsWith('/check') ? response([{ sourceId, state: 'changed', revision: updated.revision }]) : response(page(updated, 'Corrupt!')) }
    await expect(library.reconcileDownloads(requester)).rejects.toThrow('digest does not match')
    expect((await library.readDownloadedSource(sourceId))?.text).toBe('Original')
  })

  it('restarts once with the current revision when Desktop changes a note during download', async () => {
    const library = await modules()
    const original = card(sourceId, 'Original')
    const updated = card(sourceId, 'Modified')
    const requester = { mailboxId, request: async (request: { path: string }) => {
      if (request.path.endsWith('/check')) return response([{ sourceId, state: 'changed', revision: updated.revision }])
      if (request.path.includes(original.revision)) return response({}, 409)
      return response(page(updated, 'Modified'))
    } }
    await library.downloadSource(requester, original)
    expect((await library.readDownloadedSource(sourceId))?.text).toBe('Modified')
  })

  it('serializes concurrent multi-page downloads so neither staging record is erased', async () => {
    const library = await modules()
    const texts = new Map([[sourceId, 'أ'.repeat(15_000)], [replacementId, 'ب'.repeat(15_000)]])
    const cards = [...texts].map(([id, text]) => card(id, text))
    const requester = { mailboxId, request: async (request: { path: string }) => {
      const url = new URL(request.path, 'https://desktop.invalid')
      const selected = cards.find(source => url.pathname.endsWith(source.sourceId))!
      return response(page(selected, texts.get(selected.sourceId)!, Number(url.searchParams.get('offset'))))
    } }
    await Promise.all(cards.map(source => library.downloadSource(requester, source)))
    for (const [id, text] of texts) expect((await library.readDownloadedSource(id))?.text).toBe(text)
  })

  it('resumes an interrupted Arabic download at its stored byte boundary and keeps the old copy until verification', async () => {
    const library = await modules()
    const original = card(sourceId, 'Available offline')
    await library.downloadSource({ mailboxId, request: async () => response(page(original, 'Available offline')) }, original)
    const text = 'م'.repeat(12_287) + '🙂' + 'ع'.repeat(2000)
    const updated = card(sourceId, text)
    const firstAttempt = { mailboxId, request: async (request: { path: string }) => {
      const offset = Number(new URL(request.path, 'https://desktop.invalid').searchParams.get('offset'))
      if (offset > 0) throw new Error('Wireless disconnected')
      return response(page(updated, text, offset))
    } }
    await expect(library.downloadSource(firstAttempt, updated)).rejects.toThrow('Wireless disconnected')
    expect((await library.readDownloadedSource(sourceId))?.text).toBe('Available offline')
    const retriedOffsets: number[] = []
    await library.downloadSource({ mailboxId, request: async (request: { path: string }) => {
      const offset = Number(new URL(request.path, 'https://desktop.invalid').searchParams.get('offset'))
      retriedOffsets.push(offset)
      return response(page(updated, text, offset))
    } }, updated)
    expect(retriedOffsets).toEqual([24 * 1024])
    expect((await library.readDownloadedSource(sourceId))?.text).toBe(text)
    expect(await (await library.openEncryptedDatabase()).getFirstAsync('SELECT source_id FROM download_staging')).toBeNull()
  })

  it('restarts from zero when an interrupted download has a different Desktop revision', async () => {
    const library = await modules()
    const firstText = 'A'.repeat(30_000)
    const firstCard = card(sourceId, firstText)
    await expect(library.downloadSource({ mailboxId, request: async (request: { path: string }) => {
      if (!request.path.endsWith('offset=0')) throw new Error('Disconnected')
      return response(page(firstCard, firstText))
    } }, firstCard)).rejects.toThrow('Disconnected')
    const changedText = 'B'.repeat(30_000)
    const changedCard = card(sourceId, changedText)
    const offsets: number[] = []
    await library.downloadSource({ mailboxId, request: async (request: { path: string }) => {
      const offset = Number(new URL(request.path, 'https://desktop.invalid').searchParams.get('offset'))
      offsets.push(offset)
      return response(page(changedCard, changedText, offset))
    } }, changedCard)
    expect(offsets).toEqual([0, 24 * 1024])
    expect((await library.readDownloadedSource(sourceId))?.text).toBe(changedText)
  })

  it.each(['offset', 'length', 'digest', 'legacy metadata', 'mailbox'])('restarts incompatible partial staging with %s instead of trusting its saved offset', async damage => {
    const library = await modules()
    const text = 'Arabic العربية '.repeat(2000)
    const source = card(sourceId, text)
    await expect(library.downloadSource({ mailboxId, request: async (request: { path: string }) => {
      if (!request.path.endsWith('offset=0')) throw new Error('Disconnected')
      return response(page(source, text))
    } }, source)).rejects.toThrow('Disconnected')
    const database = await library.openEncryptedDatabase()
    if (damage === 'offset') await database.runAsync('UPDATE download_staging SET next_offset=total_bytes+1')
    if (damage === 'length') await database.runAsync('UPDATE download_staging SET text_bytes=?', Buffer.from('short'))
    if (damage === 'digest') await database.runAsync('UPDATE download_staging SET text_sha256=?', '0'.repeat(64))
    if (damage === 'legacy metadata') await database.runAsync('UPDATE download_staging SET metadata_json=?', JSON.stringify(source))
    const activeMailbox = damage === 'mailbox' ? 'b'.repeat(22) : mailboxId
    const offsets: number[] = []
    await library.downloadSource({ mailboxId: activeMailbox, request: async (request: { path: string }) => {
      const offset = Number(new URL(request.path, 'https://desktop.invalid').searchParams.get('offset'))
      offsets.push(offset)
      return response(page(source, text, offset))
    } }, source)
    expect(offsets[0]).toBe(0)
    expect(await library.readDownloadedSource(sourceId)).toMatchObject({ text, mailboxId: activeMailbox })
  })

  it('discards corrupt resumed bytes after digest failure so a clean retry can replace the intact offline copy', async () => {
    const library = await modules()
    const original = card(sourceId, 'Offline original')
    await library.downloadSource({ mailboxId, request: async () => response(page(original, 'Offline original')) }, original)
    const text = 'C'.repeat(30_000)
    const updated = card(sourceId, text)
    await expect(library.downloadSource({ mailboxId, request: async (request: { path: string }) => {
      if (!request.path.endsWith('offset=0')) throw new Error('Disconnected')
      return response(page(updated, text))
    } }, updated)).rejects.toThrow('Disconnected')
    const database = await library.openEncryptedDatabase()
    await database.runAsync('UPDATE download_staging SET text_bytes=?', Buffer.from('X'.repeat(24 * 1024)))
    const requester = { mailboxId, request: async (request: { path: string }) => response(page(updated, text, Number(new URL(request.path, 'https://desktop.invalid').searchParams.get('offset')))) }
    await expect(library.downloadSource(requester, updated)).rejects.toThrow('digest does not match')
    expect((await library.readDownloadedSource(sourceId))?.text).toBe('Offline original')
    expect(await database.getFirstAsync('SELECT source_id FROM download_staging')).toBeNull()
    await library.downloadSource(requester, updated)
    expect((await library.readDownloadedSource(sourceId))?.text).toBe(text)
  })

  it('checks more than 100 offline notes in bounded batches and preserves drafts on replaced notes', async () => {
    const library = await modules()
    const database = await library.openEncryptedDatabase()
    for (let index = 1; index <= 101; index += 1) {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      const source = card(id, 'Text')
      await database.runAsync('INSERT INTO downloaded_sources(source_id,revision,text_sha256,metadata_json,title,excerpt,text_bytes,byte_length,downloaded_at_ms,stale,pinned,mailbox_id) VALUES(?,?,?,?,?,?,?,?,?,0,1,?)', id, source.revision, source.textSha256, JSON.stringify(source), source.title, 'Text', Buffer.from('Text'), 4, 1, mailboxId)
    }
    await library.queueDesktopEdit(edit())
    const batchSizes: number[] = []
    const requester = { mailboxId, request: async (request: { method: string; body: unknown }) => {
      if (request.method !== 'POST') throw new Error('Pending phone edits must not be overwritten')
      const sources = (request.body as { sources: { sourceId: string; revision: string }[] }).sources
      batchSizes.push(sources.length)
      return response(sources.map(source => source.sourceId === sourceId ? { sourceId, state: 'replaced', replacement: { sourceId: replacementId, revision: 'a'.repeat(64) } } : { ...source, state: 'unchanged' }))
    } }
    await library.reconcileDownloads(requester)
    expect(batchSizes).toEqual([100, 1])
    expect((await library.readDownloadedSource(sourceId))?.text).toBe('Text')
    expect((await library.pendingDesktopEdits())[0].text).toBe('Phone edit')
  })
})
