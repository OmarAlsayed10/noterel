import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-secure-store', () => ({ getItemAsync: async () => '0'.repeat(64) }))
vi.mock('expo-file-system/legacy', () => ({ getInfoAsync: async () => ({ exists: false }) }))
vi.mock('expo-sharing', () => ({ isAvailableAsync: async () => true }))
vi.mock('expo-crypto', async () => {
  const { createHash, randomUUID } = await import('node:crypto')
  return { randomUUID, CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async (_algorithm: string, text: string) => createHash('sha256').update(text).digest('hex') }
})
vi.mock('expo-sqlite', async () => (await import('../library/databaseFixture')).sqliteBoundary())

const modules = async () => ({ ...await import('../../src/backup/notesBackupData'), ...await import('../../src/capture/outbox'), ...await import('../../src/learning'), ...await import('../../src/backup/readableExport') })
const reference = { kind: 'url' as const, text: 'https://example.com/tutorial', title: 'درس تعليمي', captureMode: 'reference' as const, takeaway: 'فكرتي' }

beforeEach(() => vi.resetModules())
afterEach(async () => {
  const { openEncryptedDatabase } = await import('../../src/storage/database')
  await (await openEncryptedDatabase()).closeAsync()
})

describe('portable personal notes', () => {
  it('exports a small collection from a cache larger than the whole-export limit', async () => {
    const notebook = await modules()
    const { openEncryptedDatabase } = await import('../../src/storage/database')
    const { createHash } = await import('node:crypto')
    const database = await openEncryptedDatabase()
    const bytes = Buffer.alloc(2 * 1024 * 1024, 120)
    const digest = createHash('sha256').update(bytes).digest('hex')
    for (let index = 1; index <= 11; index += 1) {
      const sourceId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      const metadata = { sourceId, kind: 'manual_note', title: 'Large saved note', projectId: null, projectName: null, folderName: null, relativePath: null, url: null, revision: digest, textSha256: digest, byteLength: bytes.length, updatedAt: new Date().toISOString(), downloadEligible: true, unavailableReason: null }
      await database.runAsync('INSERT INTO downloaded_sources(source_id,revision,text_sha256,metadata_json,title,excerpt,text_bytes,byte_length,downloaded_at_ms,stale,pinned,mailbox_id) VALUES(?,?,?,?,?,?,?,?,?,0,1,?)', sourceId, digest, digest, JSON.stringify(metadata), metadata.title, 'xxx', bytes, bytes.length, 1, 'a'.repeat(22))
    }
    const capture = await notebook.enqueueCapture({ kind: 'note', title: 'Small note', text: 'Only this collection' })
    await notebook.saveMemoryLearning({ sourceId: capture.id, mailboxId: null }, { ...notebook.emptyLearningDetails(), collections: ['Small'] })
    expect(await notebook.readableNotebook('Small')).toMatchObject({ count: 1 })
    await expect(notebook.readableNotebook()).rejects.toThrow('20 MiB')
  })

  it('restores a reference with its personal notes and collections under the new phone identity', async () => {
    const notebook = await modules()
    const capture = await notebook.enqueueCapture(reference)
    const details = { ...notebook.emptyLearningDetails(), takeaway: 'شرح شخصي', collections: ['دراسة'], revisit: true }
    await notebook.saveMemoryLearning({ sourceId: capture.id, mailboxId: null }, details)
    expect(await notebook.restorePhoneNotesSnapshot(await notebook.phoneNotesSnapshot())).toBe(1)
    const restored = (await notebook.phoneOnlyCaptures()).find(note => note.id !== capture.id)!
    expect(restored.payload).toEqual(reference)
    expect((await notebook.memoryLearning({ sourceId: restored.id, mailboxId: null })).details).toEqual(details)
  })

  it('continues to restore legacy encrypted-backup plaintext without personal metadata', async () => {
    const notebook = await modules()
    expect(await notebook.restorePhoneNotesSnapshot({ schemaVersion: 1, exportedAt: new Date().toISOString(), captures: [{ kind: 'note', text: 'Legacy original', title: null }] })).toBe(1)
    expect((await notebook.phoneOnlyCaptures())[0]?.payload.text).toBe('Legacy original')
  })

  it('rolls back restored captures when merging personal details would exceed their limits', async () => {
    const notebook = await modules()
    const identity = { sourceId: '00000000-0000-4000-8000-000000000001', mailboxId: 'a'.repeat(22) }
    await notebook.saveMemoryLearning(identity, { ...notebook.emptyLearningDetails(), takeaway: 'x'.repeat(8192) })
    const snapshot = { schemaVersion: 2, exportedAt: new Date().toISOString(), captures: [{ id: '00000000-0000-4000-8000-000000000002', payload: reference }], learning: [{ identity, details: { ...notebook.emptyLearningDetails(), takeaway: 'y'.repeat(8192) } }] }
    await expect(notebook.restorePhoneNotesSnapshot(snapshot)).rejects.toThrow()
    expect(await notebook.phoneOnlyCaptures()).toEqual([])
    expect((await notebook.memoryLearning(identity)).details.takeaway).toBe('x'.repeat(8192))
  })

  it('exports readable source links and personal text while filtering an optional collection', async () => {
    const notebook = await modules()
    const kept = await notebook.enqueueCapture(reference)
    await notebook.enqueueCapture({ kind: 'note', title: 'Other note', text: 'Not in this collection' })
    await notebook.saveMemoryLearning({ sourceId: kept.id, mailboxId: null }, { ...notebook.emptyLearningDetails(), takeaway: 'تذكّر المثال', collections: ['Learning'], revisit: true, annotations: [{ id: '00000000-0000-4000-8000-000000000003', note: 'My explanation', quote: 'Supporting passage', startMs: 1500, createdAtMs: 1 }] })
    const exported = await notebook.readableNotebook('learning')
    expect(exported.count).toBe(1)
    for (const text of ['https://example.com/tutorial', 'تذكّر المثال', 'My explanation', '> Supporting passage', 'Time: 1.5 s']) expect(exported.contents).toContain(text)
    expect(exported.contents).not.toContain('Not in this collection')
  })

  it('changes the automatic-backup fingerprint when only personal notes change', async () => {
    const notebook = await modules()
    const capture = await notebook.enqueueCapture(reference)
    const original = await notebook.phoneNotesFingerprint()
    await notebook.saveMemoryLearning({ sourceId: capture.id, mailboxId: null }, { ...notebook.emptyLearningDetails(), collections: ['New topic'] })
    expect(await notebook.phoneNotesFingerprint()).not.toBe(original)
  })
})
