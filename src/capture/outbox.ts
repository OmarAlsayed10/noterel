import * as Crypto from 'expo-crypto'
import { openEncryptedDatabase, withDatabaseTransaction } from '../storage/database'
import { rebuildLocalRelationships } from '../sources/relationships'
import type { IncomingShare } from './incomingShare'
import { captureStorageUsage, encodeCapturePayload, maximumCaptureStorageBytes } from './captureStorage'

export interface QueuedCapture {
  readonly id: string
  readonly operationKey: string
  readonly kind: 'note' | 'url'
  readonly payload: IncomingShare
  readonly destinationMailboxId: string | null
  readonly state: 'queued' | 'retry_wait' | 'needs_attention'
  readonly createdAtMs: number
  readonly retryCount: number
}

export async function enqueueCapture(payload: IncomingShare): Promise<QueuedCapture> {
  const id = Crypto.randomUUID()
  const { payloadJson, payloadBytes } = encodeCapturePayload(payload)
  const createdAtMs = Date.now()
  let saved: QueuedCapture | null = null
  await withDatabaseTransaction(async database => {
    const existing = await database.getFirstAsync<{ id: string; operation_key: string; destination_mailbox_id: string | null; state: QueuedCapture['state']; created_at_ms: number; retry_count: number }>(`SELECT id,operation_key,destination_mailbox_id,state,created_at_ms,retry_count FROM (
      SELECT id,id AS operation_key,NULL AS destination_mailbox_id,'queued' AS state,created_at_ms,0 AS retry_count,kind,payload_json FROM local_notes
      UNION ALL SELECT id,operation_key,destination_mailbox_id,state,created_at_ms,retry_count,kind,payload_json FROM outbox_operations
    ) WHERE kind=? AND payload_json=? ORDER BY created_at_ms LIMIT 1`, payload.kind, payloadJson)
    if (existing) {
      saved = { id: existing.id, operationKey: existing.operation_key, kind: payload.kind, payload, destinationMailboxId: existing.destination_mailbox_id, state: existing.state, createdAtMs: existing.created_at_ms, retryCount: existing.retry_count }
      return
    }
    const usage = await captureStorageUsage(database)
    if (usage.bytes + payloadBytes > maximumCaptureStorageBytes) throw new RangeError('Phone note storage is full')
    await database.runAsync('INSERT INTO local_notes(id,kind,payload_json,payload_bytes,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?)', id, payload.kind, payloadJson, payloadBytes, createdAtMs, createdAtMs)
  })
  if (saved) return saved
  await rebuildLocalRelationships(id, payload.text)
  return { id, operationKey: id, kind: payload.kind, payload, destinationMailboxId: null, state: 'queued', createdAtMs, retryCount: 0 }
}

export async function updateQueuedCapture(id: string, payload: IncomingShare): Promise<void> {
  const { payloadJson, payloadBytes } = encodeCapturePayload(payload)
  await withDatabaseTransaction(async database => {
    const local = await database.getFirstAsync<{ payload_bytes: number }>('SELECT payload_bytes FROM local_notes WHERE id=?', id)
    const queued = local ? null : await database.getFirstAsync<{ payload_bytes: number }>('SELECT payload_bytes FROM outbox_operations WHERE id=?', id)
    const current = local ?? queued
    if (!current) throw new Error('Phone note is unavailable')
    const usage = await captureStorageUsage(database)
    if (usage.bytes - current.payload_bytes + payloadBytes > maximumCaptureStorageBytes) throw new RangeError('Phone note storage is full')
    await database.runAsync('DELETE FROM local_source_links WHERE source_id=? OR related_source_id=?', id, id)
    await database.runAsync('DELETE FROM local_source_artifacts WHERE source_id=?', id)
    const rejected = await database.getFirstAsync("SELECT id FROM outbox_operations WHERE id=? AND state='needs_attention' AND json_extract(receipt_json,'$.status') BETWEEN 400 AND 499", id)
    if (local) {
      await database.runAsync('UPDATE local_notes SET kind=?,payload_json=?,payload_bytes=?,updated_at_ms=? WHERE id=?', payload.kind, payloadJson, payloadBytes, Date.now(), id)
    }
    if (!local || rejected) {
      await database.runAsync("UPDATE outbox_operations SET operation_key=?,kind=?,payload_json=?,payload_bytes=?,state='queued',retry_count=0,next_attempt_at_ms=NULL,receipt_json=NULL WHERE id=?", Crypto.randomUUID(), payload.kind, payloadJson, payloadBytes, id)
    }
  })
  await rebuildLocalRelationships(id, payload.text)
}

export async function assignQueuedCapture(id: string, mailboxId: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{22,43}$/.test(mailboxId)) throw new RangeError('Desktop mailbox is invalid')
  await withDatabaseTransaction(async database => {
    const local = await database.getFirstAsync<{ kind: 'note' | 'url'; payload_json: string; payload_bytes: number; created_at_ms: number }>('SELECT kind,payload_json,payload_bytes,created_at_ms FROM local_notes WHERE id=?', id)
    if (local) {
      const inFlight = await database.getFirstAsync<{ destination_mailbox_id: string }>('SELECT destination_mailbox_id FROM outbox_operations WHERE id=?', id)
      if (inFlight) {
        if (inFlight.destination_mailbox_id !== mailboxId) throw new Error('This note is still waiting for its original Desktop. Keep a separate phone copy before sending it elsewhere.')
        return
      }
      const linked = await database.getFirstAsync<{ mailbox_id: string | null }>("SELECT json_extract(response_json,'$.mailboxId') AS mailbox_id FROM delivery_receipts WHERE id=? AND kind IN ('note','url')", id)
      if (linked?.mailbox_id) {
        if (linked.mailbox_id !== mailboxId) throw new Error('This note belongs to another Desktop. Keep a separate phone copy before sending it elsewhere.')
        return
      }
      await database.runAsync(`INSERT INTO outbox_operations(id,operation_key,destination_mailbox_id,kind,payload_json,payload_bytes,state,created_at_ms)
        VALUES(?,?,?,?,?,?,'queued',?)`, id, Crypto.randomUUID(), mailboxId, local.kind, local.payload_json, local.payload_bytes, local.created_at_ms)
      await database.runAsync('DELETE FROM local_notes WHERE id=?', id)
      return
    }
    const result = await database.runAsync("UPDATE outbox_operations SET destination_mailbox_id=?,operation_key=?,state='queued',retry_count=0,next_attempt_at_ms=NULL WHERE id=?", mailboxId, Crypto.randomUUID(), id)
    if (result.changes !== 1) throw new Error('Phone note is unavailable')
  })
}

export async function retryQueuedCapture(id: string): Promise<void> {
  const database = await openEncryptedDatabase()
  const result = await database.runAsync("UPDATE outbox_operations SET state='queued',retry_count=0,next_attempt_at_ms=NULL WHERE id=? AND state='retry_wait'", id)
  if (result.changes !== 1) throw new Error('This capture must be edited before retrying')
}

export async function phoneOnlyCaptures(): Promise<readonly QueuedCapture[]> {
  const database = await openEncryptedDatabase()
  const rows = await database.getAllAsync<{ id: string; kind: 'note' | 'url'; payload_json: string; created_at_ms: number }>('SELECT id,kind,payload_json,created_at_ms FROM local_notes ORDER BY created_at_ms,id')
  return rows.map(row => ({ id: row.id, operationKey: row.id, destinationMailboxId: null, kind: row.kind, payload: JSON.parse(row.payload_json) as IncomingShare, state: 'queued', createdAtMs: row.created_at_ms, retryCount: 0 }))
}

export async function insertRestoredCaptures(database: Awaited<ReturnType<typeof openEncryptedDatabase>>, payloads: readonly IncomingShare[]): Promise<readonly string[]> {
  const encoded = payloads.map(payload => ({ id: Crypto.randomUUID(), payload, ...encodeCapturePayload(payload) }))
  const usage = await captureStorageUsage(database)
  if (usage.bytes + encoded.reduce((sum, capture) => sum + capture.payloadBytes, 0) > maximumCaptureStorageBytes) throw new RangeError('Restored notes would exceed the phone storage limit')
  for (const capture of encoded) {
    const now = Date.now()
    await database.runAsync('INSERT INTO local_notes(id,kind,payload_json,payload_bytes,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?)', capture.id, capture.payload.kind, capture.payloadJson, capture.payloadBytes, now, now)
  }
  return encoded.map(capture => capture.id)
}

export async function restorePhoneOnlyCapturesWithIds(payloads: readonly IncomingShare[]): Promise<readonly string[]> {
  if (payloads.length === 0) return []
  return withDatabaseTransaction(database => insertRestoredCaptures(database, payloads))
}

export async function discardQueuedCapture(id: string): Promise<void> {
  await withDatabaseTransaction(async database => {
    await database.runAsync("DELETE FROM memory_learning WHERE origin_id='phone' AND source_id=?", id)
    await database.runAsync('DELETE FROM local_source_links WHERE source_id=? OR related_source_id=?', id, id)
    await database.runAsync('DELETE FROM local_source_artifacts WHERE source_id=?', id)
    await database.runAsync('DELETE FROM local_notes WHERE id=?', id)
    await database.runAsync('DELETE FROM outbox_operations WHERE id=?', id)
    await database.runAsync("UPDATE delivery_receipts SET response_json=json_remove(response_json,'$.phonePayload') WHERE id=?", id)
  })
}

export async function queuedCaptureCount(): Promise<number> {
  const database = await openEncryptedDatabase()
  const row = await database.getFirstAsync<{ count: number }>('SELECT (SELECT count(*) FROM local_notes)+(SELECT count(*) FROM outbox_operations WHERE id NOT IN (SELECT id FROM local_notes)) AS count')
  return row?.count ?? 0
}

export async function restorePhoneOnlyCaptures(payloads: readonly IncomingShare[]): Promise<number> {
  return (await restorePhoneOnlyCapturesWithIds(payloads)).length
}
