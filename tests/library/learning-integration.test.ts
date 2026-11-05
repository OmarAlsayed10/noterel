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
const mailboxId = 'a'.repeat(22)
const foreignMailbox = 'b'.repeat(22)
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const response = (body: unknown, status = 200): MobileResponse => ({ requestId: sourceId, status, body })
const card = (id: string, text: string) => ({ sourceId: id, kind: 'manual_note' as const, title: 'Test note', projectId: null, projectName: null, folderName: null, relativePath: null, url: null, revision: sha256(`${id}:${text}`), textSha256: sha256(text), byteLength: Buffer.byteLength(text), updatedAt: '2026-10-31T00:00:00.000Z', downloadEligible: true, unavailableReason: null })
const page = (source: ReturnType<typeof card>, text: string) => ({ ...source, totalBytes: source.byteLength, offset: 0, nextOffset: null, bytes: Buffer.from(text).toString('base64url') })
const modules = async () => ({ ...await import('../../src/library/library'), ...await import('../../src/learning'), ...await import('../../src/capture/outbox'), ...await import('../../src/capture/drainOutbox'), ...await import('../../src/capture/linkedNotes'), ...await import('../../src/notes/deletion') })

beforeEach(() => vi.resetModules())
afterEach(async () => {
  const { openEncryptedDatabase } = await import('../../src/storage/database')
  await (await openEncryptedDatabase()).closeAsync()
})

describe('source and personal-note identity integration', () => {
  it.each([mailboxId, foreignMailbox])('erases confirmed revision-family copies while retaining cached origin %s only when it belongs to another Desktop', async cachedOrigin => {
    const library = await modules()
    const { openEncryptedDatabase, withDatabaseTransaction } = await import('../../src/storage/database')
    const original = card(sourceId, 'Cached original')
    await library.downloadSource({ mailboxId: cachedOrigin, request: async () => response(page(original, 'Cached original')) }, original)
    await library.saveMemoryLearning({ sourceId, mailboxId }, { ...library.emptyLearningDetails(), takeaway: 'Bound explanation' })
    await withDatabaseTransaction(database => library.rebindLearningIdentity(database, { sourceId, mailboxId }, { sourceId: replacementId, mailboxId }))
    await library.saveMemoryLearning({ sourceId, mailboxId: foreignMailbox }, { ...library.emptyLearningDetails(), takeaway: 'Another Desktop private details' })
    const database = await openEncryptedDatabase()
    const phoneCopies = []
    const pdf = Buffer.from('%PDF-1.7\n')
    for (const origin of [mailboxId, foreignMailbox, null]) {
      const label = origin ?? 'Unbound phone source'
      const capture = await library.enqueueCapture({ kind: 'note', title: label, text: origin === mailboxId ? 'Owned source body' : 'Separate current body' })
      await library.saveMemoryLearning({ sourceId: capture.id, mailboxId: null }, { ...library.emptyLearningDetails(), takeaway: label })
      await database.runAsync(`INSERT INTO local_source_artifacts(source_id,operation_key,kind,processing_authority,state,requested_url,final_url,original_sha256,original_bytes,metadata_json,text_content,text_sha256,extractor,extractor_version,extracted_at_ms,destination_mailbox_id,desktop_source_id)
        VALUES(?,?,'pdf','mobile','ready',NULL,NULL,?,?,'{"title":"Original file"}',?,?,'test','1',1,?,?)`, capture.id, capture.operationKey, sha256(pdf.toString()), pdf, capture.payload.text, sha256(capture.payload.text), origin, sourceId)
      await database.runAsync("INSERT INTO pending_pdf_imports(id,operation_key,destination_mailbox_id,filename,bytes,byte_length,sha256,state,created_at_ms) VALUES(?,?,?,'original.pdf',?,?,?,'phone_only',1)", capture.id, capture.operationKey, origin, pdf, pdf.length, sha256(pdf.toString()))
      await database.runAsync("INSERT INTO delivery_receipts(id,operation_key,kind,response_json,delivered_at_ms) VALUES(?,?,'note',?,1)", capture.id, capture.operationKey, JSON.stringify({ sourceId, mailboxId, phonePayload: { kind: 'note', title: 'Old accepted copy', text: 'Old Desktop A body' } }))
      phoneCopies.push({ id: capture.id, origin })
    }
    await library.deleteDesktopMemory({ mailboxId, request: async request => {
      expect(request.path).toBe(`/api/v1/sources/${replacementId}`)
      return response({ sourceId: replacementId, state: 'deleted' })
    } }, sourceId)
    const cached = await library.readDownloadedSource(sourceId)
    expect(cached?.text ?? null).toBe(cachedOrigin === foreignMailbox ? 'Cached original' : null)
    expect((await library.memoryLearning({ sourceId, mailboxId: foreignMailbox })).details.takeaway).toBe('Another Desktop private details')
    expect((await library.learningIndex()).filter(entry => entry.identity.mailboxId === mailboxId)).toEqual([])
    expect(await (await openEncryptedDatabase()).getAllAsync('SELECT * FROM memory_learning_aliases WHERE origin_id=?', mailboxId)).toEqual([])
    for (const copy of phoneCopies) {
      const retained = copy.origin !== mailboxId
      expect(Boolean(await database.getFirstAsync('SELECT source_id FROM local_source_artifacts WHERE source_id=?', copy.id))).toBe(retained)
      expect(Boolean(await database.getFirstAsync('SELECT id FROM pending_pdf_imports WHERE id=?', copy.id))).toBe(retained)
      expect(Boolean(await database.getFirstAsync('SELECT id FROM local_notes WHERE id=?', copy.id))).toBe(retained)
      const receipt = await database.getFirstAsync<{ response_json: string }>('SELECT response_json FROM delivery_receipts WHERE id=?', copy.id)
      expect(JSON.parse(receipt!.response_json)).not.toHaveProperty('phonePayload')
    }
  })

  it('keeps personal details with a newer retained phone capture edited during canonical download', async () => {
    const library = await modules()
    const capture = await library.enqueueCapture({ kind: 'note', text: 'Phone original', title: 'Test note' })
    await library.saveMemoryLearning({ sourceId: capture.id, mailboxId: null }, { ...library.emptyLearningDetails(), takeaway: 'Original understanding' })
    await library.assignQueuedCapture(capture.id, mailboxId)
    const current = card(sourceId, 'Phone original')
    let pages = 0
    const requester = { mailboxId, request: async (request: { path: string }) => {
      if (request.path === '/api/v1/sources') return response({ sourceId, jobId: null, outcome: 'accepted' }, 202)
      if (request.path.endsWith('/check')) return response([{ sourceId, state: 'changed', revision: current.revision }])
      pages += 1
      if (pages === 2) {
        await library.updateQueuedCapture(capture.id, { kind: 'note', text: 'Newer phone draft', title: 'Test note' })
        await library.saveMemoryLearning({ sourceId: capture.id, mailboxId: null }, { ...library.emptyLearningDetails(), takeaway: 'Newer understanding' })
      }
      return response(page(current, 'Phone original'))
    } }
    await library.drainCaptureOutbox(requester)
    await library.reconcileDeliveredNotes(requester)
    expect((await library.phoneOnlyCaptures())[0]?.payload.text).toBe('Newer phone draft')
    expect((await library.memoryLearning({ sourceId: capture.id, mailboxId: null })).details.takeaway).toBe('Newer understanding')
    expect((await library.memoryLearning({ sourceId, mailboxId })).details.takeaway).toBe('')
  })

  it('resumes compact listing downloads while retaining full titles, source links, and real video moments offline', async () => {
    const library = await modules()
    const text = 'x'.repeat(30_000)
    const listed = { ...card(sourceId, text), kind: 'video' as const, title: 'Short display title…' }
    const moments = [{ startMs: 1500, endMs: 2500, startByte: 0, endByte: 16 }]
    const fullCard = { ...listed, title: 'Full original tutorial title', url: 'https://www.youtube.com/watch?v=abcdefghijk', moments }
    const deliveredPage = (offset: number) => {
      const bytes = Buffer.from(text).subarray(offset, offset + 24 * 1024)
      return { ...fullCard, offset, totalBytes: Buffer.byteLength(text), nextOffset: offset + bytes.length === Buffer.byteLength(text) ? null : offset + bytes.length, bytes: bytes.toString('base64url') }
    }
    await expect(library.downloadSource({ mailboxId, request: async (request: { path: string }) => {
      if (!request.path.endsWith('offset=0')) throw new Error('Wireless disconnected')
      return response(deliveredPage(0))
    } }, listed)).rejects.toThrow('Wireless disconnected')
    const offsets: number[] = []
    await library.downloadSource({ mailboxId, request: async (request: { path: string }) => {
      const offset = Number(new URL(request.path, 'https://desktop.invalid').searchParams.get('offset'))
      offsets.push(offset)
      return response(deliveredPage(offset))
    } }, listed)
    expect(offsets).toEqual([24 * 1024])
    expect((await library.readDownloadedSource(sourceId))?.metadata).toMatchObject({ title: fullCard.title, url: fullCard.url, moments })
  })

  it('keeps reference takeaways and collections through accepted delivery and verified Desktop installation', async () => {
    const library = await modules()
    const url = 'https://example.com/tutorial'
    const capture = await library.enqueueCapture({ kind: 'url', text: url, title: 'Reference', captureMode: 'reference' })
    const details = { ...library.emptyLearningDetails(), takeaway: 'شرح شخصي', collections: ['Study'], revisit: true }
    await library.saveMemoryLearning({ sourceId: capture.id, mailboxId: null }, details)
    await library.assignQueuedCapture(capture.id, mailboxId)
    const current = { ...card(sourceId, url), kind: 'url' as const, title: 'Reference', url }
    const requester = { mailboxId, request: async (request: { path: string; body: unknown }) => {
      if (request.path === '/api/v1/sources/url') {
        expect(request.body).toMatchObject({ url, captureMode: 'reference' })
        return response({ sourceId, jobId: null, outcome: 'accepted' }, 202)
      }
      if (request.path.endsWith('/check')) return response([{ sourceId, state: 'changed', revision: current.revision }])
      return response({ ...page(card(sourceId, url), url), ...current })
    } }
    await library.drainCaptureOutbox(requester)
    expect((await library.phoneOnlyCaptures())[0]?.payload.text).toBe(url)
    await library.reconcileDeliveredNotes(requester)
    expect(await library.phoneOnlyCaptures()).toEqual([])
    expect((await library.readDownloadedSource(sourceId))?.text).toBe(url)
    expect((await library.memoryLearning({ sourceId, mailboxId })).details).toEqual(details)
  })

  it('moves personal notes with a verified replacement while keeping another Desktop origin separate', async () => {
    const library = await modules()
    const original = card(sourceId, 'Original')
    await library.downloadSource({ mailboxId, request: async () => response(page(original, 'Original')) }, original)
    await library.saveMemoryLearning({ sourceId, mailboxId }, { ...library.emptyLearningDetails(), takeaway: 'Keep this explanation' })
    await library.saveMemoryLearning({ sourceId, mailboxId: foreignMailbox }, { ...library.emptyLearningDetails(), takeaway: 'Other Desktop private note' })
    const replacement = card(replacementId, 'Updated source')
    await library.downloadSource({ mailboxId, request: async () => response(page(replacement, 'Updated source')) }, replacement, sourceId)
    expect((await library.memoryLearning({ sourceId: replacementId, mailboxId })).details.takeaway).toBe('Keep this explanation')
    expect((await library.memoryLearning({ sourceId, mailboxId: foreignMailbox })).details.takeaway).toBe('Other Desktop private note')
    expect(await library.readDownloadedSource(sourceId)).toBeNull()
  })

  it('does not move personal notes when replacement integrity verification fails', async () => {
    const library = await modules()
    const original = card(sourceId, 'Original')
    await library.downloadSource({ mailboxId, request: async () => response(page(original, 'Original')) }, original)
    await library.saveMemoryLearning({ sourceId, mailboxId }, { ...library.emptyLearningDetails(), takeaway: 'Intact personal note' })
    const replacement = card(replacementId, 'Changed')
    await expect(library.downloadSource({ mailboxId, request: async () => response(page(replacement, 'Corrupt')) }, replacement, sourceId)).rejects.toThrow('digest')
    expect((await library.memoryLearning({ sourceId, mailboxId })).details.takeaway).toBe('Intact personal note')
    expect((await library.memoryLearning({ sourceId: replacementId, mailboxId })).details.takeaway).toBe('')
    expect((await library.readDownloadedSource(sourceId))?.text).toBe('Original')
  })

  it('keeps personal notes on a failed deletion and removes only the confirmed Desktop origin', async () => {
    const library = await modules()
    for (const origin of [mailboxId, foreignMailbox]) await library.saveMemoryLearning({ sourceId, mailboxId: origin }, { ...library.emptyLearningDetails(), takeaway: origin })
    await expect(library.deleteDesktopMemory({ mailboxId, request: async () => response({}, 503) }, sourceId)).rejects.toThrow()
    expect((await library.memoryLearning({ sourceId, mailboxId })).details.takeaway).toBe(mailboxId)
    await library.deleteDesktopMemory({ mailboxId, request: async () => response({ sourceId, state: 'deleted' }) }, sourceId)
    expect((await library.memoryLearning({ sourceId, mailboxId })).details.takeaway).toBe('')
    expect((await library.memoryLearning({ sourceId, mailboxId: foreignMailbox })).details.takeaway).toBe(foreignMailbox)
  })
})
