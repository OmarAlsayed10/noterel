import { randomUUID } from 'expo-crypto'
import type { SQLiteDatabase } from 'expo-sqlite'
import { sha256 } from '../bytes'
import { rebuildLocalRelationshipsInTransaction } from '../sources/relationships'
import { openEncryptedDatabase, withDatabaseTransaction } from '../storage/database'
import type { TranscriptionOrigin } from '../transcription/source'
import { captureStorageUsage, encodeCapturePayload, maximumCaptureStorageBytes } from './captureStorage'
import type { IncomingShare } from './incomingShare'

interface FailedCapture {
  readonly id: string
  readonly payload_json: string
  readonly payload_bytes: number
}

const failedCaptureQuery = `SELECT note.id,note.payload_json,note.payload_bytes
  FROM local_notes note JOIN local_source_artifacts artifact ON artifact.source_id=note.id
  WHERE note.id=? AND note.kind='url' AND artifact.state='needs_attention' AND artifact.text_sha256=''
    AND artifact.processing_authority='mobile' AND artifact.desktop_source_id IS NULL AND artifact.destination_mailbox_id IS NULL
    AND json_extract(artifact.metadata_json,'$.userEditedAtMs') IS NULL
    AND NOT EXISTS(SELECT 1 FROM outbox_operations WHERE id=note.id)
    AND NOT EXISTS(SELECT 1 FROM delivery_receipts WHERE id=note.id)`

const failedCapture = (database: SQLiteDatabase, captureId: string): Promise<FailedCapture | null> => database.getFirstAsync<FailedCapture>(failedCaptureQuery, captureId)

export async function failedCaptureSnapshot(captureId: string, url: string): Promise<TranscriptionOrigin | null> {
  const saved = await failedCapture(await openEncryptedDatabase(), captureId)
  if (!saved) return null
  const payload = JSON.parse(saved.payload_json) as IncomingShare
  if (payload.kind !== 'url' || payload.text !== url) return null
  return { url, title: payload.title, captureId, capturePayloadSha256: await sha256(new TextEncoder().encode(saved.payload_json)) }
}

async function replacementCapture(database: SQLiteDatabase, origin: TranscriptionOrigin | undefined): Promise<FailedCapture | null> {
  if (!origin?.captureId || !origin.capturePayloadSha256) return null
  const saved = await failedCapture(database, origin.captureId)
  if (!saved || (JSON.parse(saved.payload_json) as IncomingShare).text !== origin.url) return null
  return await sha256(new TextEncoder().encode(saved.payload_json)) === origin.capturePayloadSha256 ? saved : null
}

export interface SavedTranscriptCapture {
  readonly sourceId: string
  readonly replaced: boolean
  readonly originalPreserved: boolean
}

type TranscriptWrite = ReturnType<typeof encodeCapturePayload> & { readonly jobId: string; readonly text: string; readonly origin: TranscriptionOrigin | undefined }

async function requireTranscriptStorage(database: SQLiteDatabase, payloadBytes: number, replacedBytes: number): Promise<void> {
  const usage = await captureStorageUsage(database)
  if (usage.bytes - replacedBytes + payloadBytes > maximumCaptureStorageBytes) throw new RangeError('Phone note storage is full')
}

async function replaceFailedTranscript(database: SQLiteDatabase, original: FailedCapture, write: TranscriptWrite): Promise<boolean> {
  await requireTranscriptStorage(database, write.payloadBytes, original.payload_bytes)
  const updated = await database.runAsync(`UPDATE local_notes SET kind='note',payload_json=?,payload_bytes=?,updated_at_ms=? WHERE id=? AND payload_json=? AND EXISTS(${failedCaptureQuery})`, write.payloadJson, write.payloadBytes, Date.now(), original.id, original.payload_json, original.id)
  if (updated.changes !== 1) return false
  const removed = await database.runAsync("DELETE FROM local_source_artifacts WHERE source_id=? AND state='needs_attention' AND text_sha256=''", original.id)
  if (removed.changes !== 1) throw new Error('The original video changed while saving. Try saving again.')
  return true
}

async function insertTranscriptCapture(database: SQLiteDatabase, write: TranscriptWrite): Promise<string> {
  await requireTranscriptStorage(database, write.payloadBytes, 0)
  const sourceId = randomUUID()
  const now = Date.now()
  await database.runAsync("INSERT INTO local_notes(id,kind,payload_json,payload_bytes,created_at_ms,updated_at_ms) VALUES(?,'note',?,?,?,?)", sourceId, write.payloadJson, write.payloadBytes, now, now)
  return sourceId
}

async function writeTranscriptCapture(database: SQLiteDatabase, write: TranscriptWrite): Promise<{ sourceId: string; text: string }> {
  const existing = await database.getFirstAsync<{ id: string; payload_json: string }>(`SELECT id,payload_json FROM local_notes WHERE json_extract(payload_json,'$.transcription.jobId')=?
    UNION ALL SELECT id,payload_json FROM outbox_operations queued WHERE json_extract(payload_json,'$.transcription.jobId')=?
      AND NOT EXISTS(SELECT 1 FROM local_notes note WHERE note.id=queued.id) LIMIT 1`, write.jobId, write.jobId)
  if (existing) return { sourceId: existing.id, text: (JSON.parse(existing.payload_json) as IncomingShare).text }
  const original = await replacementCapture(database, write.origin)
  const sourceId = original && await replaceFailedTranscript(database, original, write) ? original.id : await insertTranscriptCapture(database, write)
  return { sourceId, text: write.text }
}

export async function persistTranscriptCapture(payload: IncomingShare, origin: TranscriptionOrigin | undefined): Promise<SavedTranscriptCapture> {
  if (!payload.transcription || payload.kind !== 'note') throw new RangeError('Reviewed transcription is required')
  const write = { ...encodeCapturePayload(payload), jobId: payload.transcription.jobId, text: payload.text, origin }
  const saved = await withDatabaseTransaction(async database => {
    const capture = await writeTranscriptCapture(database, write)
    await rebuildLocalRelationshipsInTransaction(database, capture.sourceId, capture.text)
    return capture
  })
  return { sourceId: saved.sourceId, replaced: saved.sourceId === origin?.captureId, originalPreserved: Boolean(origin?.captureId && saved.sourceId !== origin.captureId) }
}
