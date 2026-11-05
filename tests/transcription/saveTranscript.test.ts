import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AudioTranscriptionJob } from '../../src/transcription/transcription'

const storage = vi.hoisted(() => ({ filename: '' }))
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => '0'.repeat(64) }))
vi.mock('expo-file-system/legacy', () => ({ getInfoAsync: async () => ({ exists: false }) }))
vi.mock('expo-crypto', async () => {
  const crypto = await import('node:crypto')
  return { randomUUID: crypto.randomUUID, CryptoDigestAlgorithm: { SHA256: 'sha256' }, digest: async (_algorithm: string, bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest() }
})
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => (await import('../library/databaseFixture')).sqliteBoundary(storage.filename).openDatabaseAsync() }))

const videoUrl = 'https://www.facebook.com/share/v/1HWHi6QbX4/'
const thumbnailUrl = 'https://images.example.com/video.jpg'
const database = async () => (await import('../../src/storage/database')).openEncryptedDatabase()
const workflow = () => import('../../src/transcription/saveTranscript')
const captures = () => import('../../src/capture/outbox')

async function failedVideo() {
  const capture = await (await captures()).enqueueCapture({ kind: 'url', text: videoUrl, title: 'Seven levels', captureMode: 'extract', takeaway: 'My existing takeaway' })
  await (await database()).runAsync(`INSERT INTO local_source_artifacts(source_id,operation_key,kind,processing_authority,state,requested_url,original_sha256,original_bytes,metadata_json,text_content,text_sha256,extractor,extractor_version,extracted_at_ms)
    VALUES(?,?,'video','mobile','needs_attention',?,'',x'','{}','','','','',1)`, capture.id, randomUUID(), videoUrl)
  return capture
}

async function succeededJob(captureId?: string): Promise<AudioTranscriptionJob> {
  const origin = { ...await (await workflow()).sourceForTranscription(captureId, videoUrl), thumbnailUrl }
  return { id: randomUUID(), state: 'succeeded', progress: 100, text: 'A complete spoken transcript.', origin }
}

async function storedCapture(sourceId: string) {
  return (await captures()).phoneOnlyCaptures().then(notes => notes.find(note => note.id === sourceId))
}

beforeEach(() => {
  storage.filename = join(mkdtempSync(join(tmpdir(), 'noterel-transcript-save-')), 'notes.db')
  vi.resetModules()
})
afterEach(async () => {
  await (await database()).closeAsync()
  rmSync(join(storage.filename, '..'), { recursive: true, force: true })
})

describe('reviewed video transcript saving', () => {
  it('rolls back note replacement and the failed artifact when relationship indexing fails', async () => {
    const original = await failedVideo()
    const job = await succeededJob(original.id)
    await (await captures()).enqueueCapture({ kind: 'note', title: 'Related speech', text: job.text! })
    await (await database()).execAsync("CREATE TRIGGER reject_transcript_links BEFORE INSERT ON local_source_links BEGIN SELECT RAISE(FAIL,'Index write failed'); END")
    await expect((await workflow()).saveReviewedTranscript(job, { title: 'Reviewed lesson', text: job.text! })).rejects.toThrow('Index write failed')
    expect((await storedCapture(original.id))!.payload).toEqual(original.payload)
    expect(await (await database()).getFirstAsync('SELECT state FROM local_source_artifacts WHERE source_id=?', original.id)).toEqual({ state: 'needs_attention' })
  })

  it('upgrades the failed note in place and keeps learning metadata and the original video', async () => {
    const original = await failedVideo()
    const learning = await import('../../src/learning')
    const details = { ...learning.emptyLearningDetails(), takeaway: 'My interpretation', collections: ['DevOps'], revisit: true }
    await learning.saveMemoryLearning({ sourceId: original.id, mailboxId: null }, details)
    const job = await succeededJob(original.id)
    expect(await (await workflow()).saveReviewedTranscript(job, { title: 'Reviewed lesson', text: job.text! })).toEqual({ sourceId: original.id, replaced: true, originalPreserved: false })
    const saved = await storedCapture(original.id)
    expect(await (await captures()).queuedCaptureCount()).toBe(1)
    expect(saved).toMatchObject({ kind: 'note', payload: { title: 'Reviewed lesson', transcription: { jobId: job.id, source: { url: videoUrl, thumbnailUrl } } } })
    expect(saved!.payload.text).toContain(`](${videoUrl})`)
    expect(saved!.payload.text).toContain(job.text)
    expect(await (await database()).getFirstAsync('SELECT source_id FROM local_source_artifacts WHERE source_id=?', original.id)).toBeNull()
    expect((await learning.memoryLearning({ sourceId: original.id, mailboxId: null })).details).toEqual(details)
    const { notebookBackupSchema } = await import('../../src/backup/notesBackupFormat')
    expect(notebookBackupSchema.parse({ schemaVersion: 2, exportedAt: new Date().toISOString(), captures: [{ id: saved!.id, payload: saved!.payload }], learning: [] }).captures[0]!.payload.transcription!.source!.url).toBe(videoUrl)
  })

  it.each(['edited', 'sent', 'deleted'] as const)('keeps a %s source unchanged and saves a separate transcript', async change => {
    const original = await failedVideo()
    const job = await succeededJob(original.id)
    if (change === 'edited') {
      const changed = { ...original.payload, title: 'My newer title' }
      const json = JSON.stringify(changed)
      await (await database()).runAsync('UPDATE local_notes SET payload_json=?,payload_bytes=? WHERE id=?', json, Buffer.byteLength(json), original.id)
    } else if (change === 'sent') await (await captures()).assignQueuedCapture(original.id, 'a'.repeat(22))
    else await (await captures()).discardQueuedCapture(original.id)
    const before = await (await database()).getFirstAsync('SELECT * FROM local_source_artifacts WHERE source_id=?', original.id)
    const saved = await (await workflow()).saveReviewedTranscript(job, { title: 'Transcript', text: job.text! })
    expect(saved).toMatchObject({ replaced: false, originalPreserved: true })
    expect(saved.sourceId).not.toBe(original.id)
    expect((await storedCapture(saved.sourceId))!.payload.text).toContain(job.text)
    expect(await (await database()).getFirstAsync('SELECT * FROM local_source_artifacts WHERE source_id=?', original.id)).toEqual(before)
    if (change === 'edited') expect((await storedCapture(original.id))!.payload.title).toBe('My newer title')
    if (change === 'sent') expect(await (await database()).getFirstAsync('SELECT id FROM outbox_operations WHERE id=?', original.id)).toEqual({ id: original.id })
    if (change === 'deleted') expect(await storedCapture(original.id)).toBeUndefined()
  })

  it('keeps the original failed source when saving exceeds the storage quota', async () => {
    const original = await failedVideo()
    const job = await succeededJob(original.id)
    const notebook = await captures()
    for (let index = 0; index < 10; index += 1) await notebook.enqueueCapture({ kind: 'note', title: String(index), text: 'x'.repeat(1_048_000) })
    await expect((await workflow()).saveReviewedTranscript(job, { title: 'Transcript', text: 'y'.repeat(10_000) })).rejects.toThrow('storage is full')
    expect((await storedCapture(original.id))!.payload).toEqual(original.payload)
    expect(await (await database()).getFirstAsync<{ state: string }>('SELECT state FROM local_source_artifacts WHERE source_id=?', original.id)).toEqual({ state: 'needs_attention' })
  })

  it('does not save incomplete jobs and does not duplicate a saved job after restart', async () => {
    const original = await failedVideo()
    const job = await succeededJob(original.id)
    await expect((await workflow()).saveReviewedTranscript({ ...job, state: 'failed' }, { title: 'Transcript', text: job.text! })).rejects.toThrow('not ready')
    expect((await storedCapture(original.id))!.kind).toBe('url')
    const first = await (await workflow()).saveReviewedTranscript(job, { title: 'Transcript', text: job.text! })
    await (await database()).closeAsync()
    vi.resetModules()
    const second = await (await workflow()).saveReviewedTranscript(job, { title: 'A retry title', text: 'A different retry body' })
    expect(second).toEqual(first)
    expect(await (await captures()).queuedCaptureCount()).toBe(1)
    expect((await storedCapture(first.sourceId))!.payload.title).toBe('Transcript')
    expect((await storedCapture(first.sourceId))!.payload.text).toContain(job.text)
  })
})
