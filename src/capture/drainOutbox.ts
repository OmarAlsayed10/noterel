import { openEncryptedDatabase, withDatabaseTransaction } from '../storage/database'
import type { IncomingShare } from './incomingShare'
import type { MobileResponse } from '../companion/protocol'
import { z } from 'zod'
import { createDesktopNote } from '../notes/desktop'

interface CompanionRequester {
  readonly mailboxId: string
  readonly request: (input: { method: 'POST' | 'PUT' | 'GET'; path: string; body: unknown }) => Promise<MobileResponse>
}

interface OutboxRow {
  readonly id: string
  readonly operation_key: string
  readonly kind: 'note' | 'url'
  readonly payload_json: string
  readonly retry_count: number
}

const retryDelay = (attempt: number): number => Math.min(60 * 60 * 1000, 1000 * 2 ** Math.min(attempt, 12))

async function nextOperation(mailboxId: string): Promise<OutboxRow | null> {
  const database = await openEncryptedDatabase()
  return await database.getFirstAsync<OutboxRow>(`SELECT id,operation_key,kind,payload_json,retry_count FROM outbox_operations
    WHERE destination_mailbox_id=? AND state IN ('queued','retry_wait') AND (next_attempt_at_ms IS NULL OR next_attempt_at_ms<=?) ORDER BY created_at_ms,id LIMIT 1`, mailboxId, Date.now())
}

const retainsPhoneCopy = (operation: OutboxRow): boolean => operation.kind === 'note' || (JSON.parse(operation.payload_json) as IncomingShare).captureMode === 'reference'

const acceptedCaptureSchema = z.object({ sourceId: z.string().uuid() }).passthrough()

async function prepareCaptureDispatch(operation: OutboxRow): Promise<boolean> {
  if (!retainsPhoneCopy(operation)) return true
  return withDatabaseTransaction(async database => {
    const current = await database.getFirstAsync<{ payload_bytes: number; created_at_ms: number }>('SELECT payload_bytes,created_at_ms FROM outbox_operations WHERE id=? AND operation_key=?', operation.id, operation.operation_key)
    if (!current) return false
    await database.runAsync('INSERT OR IGNORE INTO local_notes(id,kind,payload_json,payload_bytes,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?)', operation.id, operation.kind, operation.payload_json, current.payload_bytes, current.created_at_ms, Date.now())
    return true
  })
}

async function recordResult(operation: OutboxRow, response: MobileResponse, mailboxId: string): Promise<void> {
  await withDatabaseTransaction(async database => {
    if (response.status === 200 || response.status === 202) {
      const deliveredAtMs = Date.now()
      const receipt = retainsPhoneCopy(operation) ? { ...acceptedCaptureSchema.parse(response.body), mailboxId, phonePayload: JSON.parse(operation.payload_json) as IncomingShare } : response.body
      if (retainsPhoneCopy(operation)) {
        const current = await database.getFirstAsync<{ payload_json: string; payload_bytes: number; kind: string; created_at_ms: number }>('SELECT payload_json,payload_bytes,kind,created_at_ms FROM outbox_operations WHERE id=? AND destination_mailbox_id=?', operation.id, mailboxId)
        if (current) await database.runAsync('INSERT OR IGNORE INTO local_notes(id,kind,payload_json,payload_bytes,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?)', operation.id, current.kind, current.payload_json, current.payload_bytes, current.created_at_ms, deliveredAtMs)
      }
      await database.runAsync(`INSERT INTO delivery_receipts(id,operation_key,kind,response_json,delivered_at_ms) VALUES(?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET operation_key=excluded.operation_key,kind=excluded.kind,response_json=excluded.response_json,delivered_at_ms=excluded.delivered_at_ms`, operation.id, operation.operation_key, operation.kind, JSON.stringify(receipt), deliveredAtMs)
      await database.runAsync("UPDATE delivery_receipts SET response_json=json_remove(response_json,'$.phonePayload') WHERE id=? AND NOT EXISTS(SELECT 1 FROM local_notes WHERE id=?)", operation.id, operation.id)
      await database.runAsync('DELETE FROM outbox_operations WHERE id=? AND destination_mailbox_id=?', operation.id, mailboxId)
      await database.runAsync('DELETE FROM delivery_receipts WHERE delivered_at_ms<? AND id NOT IN (SELECT id FROM local_notes)', deliveredAtMs - 30 * 24 * 60 * 60 * 1000)
    } else if (response.status >= 400 && response.status < 500) {
      await database.runAsync("UPDATE outbox_operations SET state='needs_attention',next_attempt_at_ms=NULL,receipt_json=? WHERE id=? AND operation_key=?", JSON.stringify(response), operation.id, operation.operation_key)
    } else {
      await scheduleRetry(database, operation)
    }
  })
}

async function scheduleRetry(database: Awaited<ReturnType<typeof openEncryptedDatabase>>, operation: OutboxRow): Promise<void> {
  const retryCount = operation.retry_count + 1
  const state = retryCount >= 100 ? 'needs_attention' : 'retry_wait'
  await database.runAsync('UPDATE outbox_operations SET state=?,retry_count=?,next_attempt_at_ms=? WHERE id=? AND operation_key=?', state, retryCount, state === 'retry_wait' ? Date.now() + retryDelay(retryCount) : null, operation.id, operation.operation_key)
}

interface CaptureDrainResult {
  readonly deliveredOperationIds: readonly string[]
}

async function drain(requester: CompanionRequester): Promise<CaptureDrainResult> {
  const deliveredOperationIds: string[] = []
  while (true) {
    const operation = await nextOperation(requester.mailboxId)
    if (!operation) return { deliveredOperationIds }
    if (!await prepareCaptureDispatch(operation)) continue
    const payload = JSON.parse(operation.payload_json) as IncomingShare
    const request = operation.kind === 'url'
      ? { method: 'POST' as const, path: '/api/v1/sources/url', body: { url: payload.text, idempotencyKey: operation.operation_key, ...(payload.captureMode ? { captureMode: payload.captureMode, ...(payload.title ? { title: payload.title } : {}), ...(payload.takeaway ? { takeaway: payload.takeaway } : {}) } : {}) } }
      : { method: 'POST' as const, path: '/api/v1/sources', body: { kind: 'manual_note', text: payload.text, ...(payload.title ? { title: payload.title } : {}), idempotencyKey: operation.operation_key } }
    try {
      const response = operation.kind === 'note' ? await createDesktopNote(requester, { title: payload.title, text: payload.text, idempotencyKey: operation.operation_key }) : await requester.request(request)
      await recordResult(operation, response, requester.mailboxId)
      if (response.status === 200 || response.status === 202) deliveredOperationIds.push(operation.id)
      if (response.status >= 500) return { deliveredOperationIds }
    } catch {
      const database = await openEncryptedDatabase()
      await scheduleRetry(database, operation)
      return { deliveredOperationIds }
    }
  }
}

let activeDrain: Promise<CaptureDrainResult> | null = null

export function drainCaptureOutbox(requester: CompanionRequester): Promise<CaptureDrainResult> {
  if (activeDrain) return activeDrain
  activeDrain = drain(requester).finally(() => { activeDrain = null })
  return activeDrain
}
