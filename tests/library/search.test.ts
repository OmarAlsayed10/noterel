import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizedSearchText, searchRanges } from '../../src/library/searchText'
import { emptyLibraryFilters } from '../../src/library/searchQuery'

vi.mock('expo-secure-store', () => ({ getItemAsync: async () => '0'.repeat(64) }))
vi.mock('expo-file-system/legacy', () => ({ getInfoAsync: async () => ({ exists: false }) }))
vi.mock('expo-crypto', async () => {
  const { createHash, randomUUID } = await import('node:crypto')
  return { randomUUID, CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async (_algorithm: string, text: string) => createHash('sha256').update(text).digest('hex') }
})
vi.mock('expo-sqlite', async () => (await import('./databaseFixture')).sqliteBoundary())

beforeEach(() => vi.resetModules())
afterEach(async () => {
  vi.restoreAllMocks()
  const { openEncryptedDatabase } = await import('../../src/storage/database')
  await (await openEncryptedDatabase()).closeAsync()
})

describe('context search before pagination', () => {
  it('saves a reference and its takeaway offline without requesting the source or creating extraction work', async () => {
    const { normalizeIncomingShare } = await import('../../src/capture/incomingShare')
    const { saveCaptureLocally, prepareCapturedSource } = await import('../../src/capture/saveCapture')
    const { memoryLearning } = await import('../../src/learning')
    const { openEncryptedDatabase } = await import('../../src/storage/database')
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network allowed'))
    const payload = normalizeIncomingShare({ text: 'https://example.com/lesson', title: 'My lesson', takeaway: 'Use this explanation in my project' })
    const sourceId = await saveCaptureLocally(payload)
    expect(await prepareCapturedSource(sourceId, payload)).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    const database = await openEncryptedDatabase()
    expect(await database.getFirstAsync('SELECT source_id FROM local_source_artifacts WHERE source_id=?', sourceId)).toBeNull()
    expect((await memoryLearning({ sourceId, mailboxId: null })).details.takeaway).toBe(payload.takeaway)
    expect(await database.getFirstAsync<{ payload_json: string }>('SELECT payload_json FROM local_notes WHERE id=?', sourceId)).toMatchObject({ payload_json: JSON.stringify(payload) })
  })

  it('sends a lightweight reference while retaining the phone copy and its bound delivery receipt', async () => {
    const { normalizeIncomingShare } = await import('../../src/capture/incomingShare')
    const { saveCaptureLocally } = await import('../../src/capture/saveCapture')
    const { assignQueuedCapture } = await import('../../src/capture/outbox')
    const { drainCaptureOutbox } = await import('../../src/capture/drainOutbox')
    const { phoneMemoryPage } = await import('../../src/library/phoneMemories')
    const { openEncryptedDatabase } = await import('../../src/storage/database')
    const payload = normalizeIncomingShare({ text: 'https://example.com/watch', title: 'Saved video', takeaway: 'Useful example' })
    const sourceId = await saveCaptureLocally(payload)
    const mailboxId = 'a'.repeat(22)
    await assignQueuedCapture(sourceId, mailboxId)
    const requests: { path: string; body: unknown }[] = []
    const canonicalId = '00000000-0000-4000-8000-000000000001'
    const delivered = await drainCaptureOutbox({ mailboxId, request: async request => {
      requests.push(request)
      return { requestId: canonicalId, status: 202, body: { sourceId: canonicalId, jobId: null, outcome: 'accepted' } }
    } })
    expect(delivered.deliveredOperationIds).toEqual([sourceId])
    expect(requests).toMatchObject([{ path: '/api/v1/sources/url', body: { url: payload.text, title: payload.title, captureMode: 'reference', takeaway: payload.takeaway } }])
    expect(await phoneMemoryPage()).toMatchObject([{ type: 'capture', capture: { id: sourceId, payload, destinationMailboxId: mailboxId } }])
    const receipt = await (await openEncryptedDatabase()).getFirstAsync<{ response_json: string }>('SELECT response_json FROM delivery_receipts WHERE id=?', sourceId)
    expect(JSON.parse(receipt!.response_json)).toMatchObject({ sourceId: canonicalId, mailboxId, phonePayload: payload })
  })

  it('finds Arabic words across original material and personal notes before collection/date/revisit pagination', async () => {
    const { enqueueCapture } = await import('../../src/capture/outbox')
    const { emptyLearningDetails, saveMemoryLearning } = await import('../../src/learning')
    const { phoneMemoryCount, phoneMemoryPage } = await import('../../src/library/phoneMemories')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const older = await enqueueCapture({ kind: 'note', title: 'الإِدارة', text: 'محتوى قديم' })
    clock.mockReturnValue(10000)
    const recent = await enqueueCapture({ kind: 'note', title: 'الإِدارة', text: 'محتوى جديد' })
    const unrelated = await enqueueCapture({ kind: 'note', title: 'إدارة', text: 'غير مختار' })
    for (const capture of [older, recent]) await saveMemoryLearning({ sourceId: capture.id, mailboxId: null }, { ...emptyLearningDetails(), takeaway: 'دروس العَرَبِيّة', collections: ['دراسة'], revisit: true })
    await saveMemoryLearning({ sourceId: unrelated.id, mailboxId: null }, { ...emptyLearningDetails(), takeaway: 'العربية' })
    const selected = { ...emptyLibraryFilters(), collection: 'دراسة', revisitOnly: true }
    expect(await phoneMemoryCount('العربية الادارة', selected)).toBe(2)
    expect(await phoneMemoryPage('العربية الادارة', 1, 1, selected)).toMatchObject([{ type: 'capture', capture: { id: older.id } }])
    expect(await phoneMemoryCount('العربية الادارة', { ...selected, sinceMs: 5000 })).toBe(1)
    expect(await phoneMemoryPage('العربية الادارة', 1, 0, { ...selected, sinceMs: 5000 })).toMatchObject([{ type: 'capture', capture: { id: recent.id } }])
    expect(await phoneMemoryCount('العربية الادارة', { ...selected, kind: 'pdf' })).toBe(0)
  })

  it('searches downloaded personal annotations without mixing another desktop origin', async () => {
    const { downloadSource, localLibrary, localLibraryCount } = await import('../../src/library/library')
    const { emptyLearningDetails, saveMemoryLearning } = await import('../../src/learning')
    const text = 'Technical explanation'
    const sourceId = '00000000-0000-4000-8000-000000000001'
    const sha = createHash('sha256').update(text).digest('hex')
    const card = { sourceId, kind: 'manual_note', title: 'English tutorial', projectId: null, projectName: null, folderName: null, relativePath: null, url: null, revision: sha, textSha256: sha, byteLength: Buffer.byteLength(text), updatedAt: '2020-01-01T00:00:00.000Z', downloadEligible: true, unavailableReason: null }
    await downloadSource({ mailboxId: 'a'.repeat(22), request: async () => ({ requestId: sourceId, status: 200, body: { ...card, totalBytes: card.byteLength, offset: 0, nextOffset: null, bytes: Buffer.from(text).toString('base64url') } }) }, card)
    await saveMemoryLearning({ sourceId, mailboxId: 'b'.repeat(22) }, { ...emptyLearningDetails(), takeaway: 'Private foreign annotation' })
    expect(await localLibraryCount('foreign')).toBe(0)
    await saveMemoryLearning({ sourceId, mailboxId: 'a'.repeat(22) }, { ...emptyLearningDetails(), takeaway: 'مُلاحظتي العربية', collections: ['Practice'], revisit: true })
    const filters = { ...emptyLibraryFilters(), collection: 'practice', revisitOnly: true }
    expect(await localLibraryCount('tutorial ملاحظتي', filters)).toBe(1)
    expect(await localLibrary('tutorial ملاحظتي', 1, 0, filters)).toMatchObject([{ sourceId }])
    expect(await localLibrary('tutorial ملاحظتي', 1, 1, filters)).toEqual([])
    expect(await localLibraryCount('tutorial', { ...filters, sinceMs: Date.now() - 7 * 86400000 })).toBe(0)
  })

  it('filters actual source hosts and subdomains before paging instead of matching a URL query string', async () => {
    const { enqueueCapture } = await import('../../src/capture/outbox')
    const { phoneMemoryCount, phoneMemoryPage } = await import('../../src/library/phoneMemories')
    const youtube = await enqueueCapture({ kind: 'url', title: 'YouTube', text: 'https://www.youtube.com/watch?v=one' })
    await enqueueCapture({ kind: 'url', title: 'TikTok', text: 'https://www.tiktok.com/@example/video/123' })
    await enqueueCapture({ kind: 'url', title: 'Other', text: 'https://notyoutube.com?source=youtube.com' })
    const filters = { ...emptyLibraryFilters(), source: 'youtube.com' }
    expect(await phoneMemoryCount('', filters)).toBe(1)
    expect(await phoneMemoryPage('', 1, 0, filters)).toMatchObject([{ type: 'capture', capture: { id: youtube.id } }])
    expect(await phoneMemoryPage('', 1, 1, filters)).toEqual([])
  })

  it('keeps a transferred phone source discoverable through its canonical personal notes', async () => {
    const { enqueueCapture } = await import('../../src/capture/outbox')
    const { emptyLearningDetails, saveMemoryLearning } = await import('../../src/learning')
    const { openEncryptedDatabase } = await import('../../src/storage/database')
    const { phoneMemoryCount } = await import('../../src/library/phoneMemories')
    const capture = await enqueueCapture({ kind: 'url', title: 'Reference', text: 'https://example.com/' })
    const canonicalId = '00000000-0000-4000-8000-000000000001'
    const mailboxId = 'a'.repeat(22)
    await (await openEncryptedDatabase()).runAsync(`INSERT INTO local_source_artifacts(source_id,operation_key,kind,processing_authority,state,original_sha256,original_bytes,metadata_json,text_content,text_sha256,extractor,extractor_version,extracted_at_ms,destination_mailbox_id,desktop_source_id) VALUES(?,?,'url','mobile','ready','',?,'{}','Prepared text','','fixture','1',0,?,?)`, capture.id, capture.id, new Uint8Array(), mailboxId, canonicalId)
    await saveMemoryLearning({ sourceId: canonicalId, mailboxId }, { ...emptyLearningDetails(), takeaway: 'canonical explanation', collections: ['Project'], revisit: true })
    expect(await phoneMemoryCount('canonical explanation', { ...emptyLibraryFilters(), collection: 'project', revisitOnly: true })).toBe(1)
  })

  it('maps normalized matches back to intact Arabic and emoji boundaries', () => {
    const text = '🙂 إِدارة الـمَعْرِفة'
    expect(normalizedSearchText(text)).toBe('🙂 ادارة المعرفة')
    expect(searchRanges(text, 'ادارة المعرفة').map(range => text.slice(range.start, range.end))).toEqual(['إِدارة', 'الـمَعْرِفة'])
    expect(searchRanges('مُقَدِّمَةٌ', 'مقدمة').map(range => 'مُقَدِّمَةٌ'.slice(range.start, range.end))).toEqual(['مُقَدِّمَةٌ'])
  })
})
