import * as Crypto from 'expo-crypto'
import { z } from 'zod'
import type { MobileResponse } from '../companion/protocol'
import { currentDesktopCard, downloadSource } from '../library/library'
import { queueDesktopEdit } from '../notes/pendingEdits'
import { openEncryptedDatabase, withDatabaseTransaction } from '../storage/database'
import type { IncomingShare } from './incomingShare'
import { rebindLearningIdentity } from '../learning'

const linkedReceiptSchema = z.object({ sourceId: z.string().uuid(), mailboxId: z.string(), jobId: z.string().uuid().nullable().optional(), existingJobId: z.string().uuid().nullable().optional(), phonePayload: z.object({ kind: z.enum(['note', 'url']), text: z.string(), title: z.string().nullable() }).passthrough() }).passthrough()

interface CompanionRequester {
  readonly mailboxId: string
  readonly request: (input: { method: 'GET' | 'POST' | 'PUT'; path: string; body: unknown }) => Promise<MobileResponse>
}

export async function linkedPhoneNote(captureId: string): Promise<{ sourceId: string; mailboxId: string } | null> {
  const database = await openEncryptedDatabase()
  const row = await database.getFirstAsync<{ response_json: string }>('SELECT response_json FROM delivery_receipts WHERE id=? AND kind=?', captureId, 'note')
  const receipt = row ? linkedReceiptSchema.safeParse(JSON.parse(row.response_json)) : null
  return receipt?.success ? { sourceId: receipt.data.sourceId, mailboxId: receipt.data.mailboxId } : null
}

async function acceptedDeliveryReady(requester: CompanionRequester, captureId: string, receipt: z.infer<typeof linkedReceiptSchema>): Promise<boolean> {
  const jobId = receipt.jobId ?? receipt.existingJobId
  const database = await openEncryptedDatabase()
  if (jobId) {
    const response = await requester.request({ method: 'GET', path: `/api/v1/jobs/${jobId}`, body: null })
    if (response.status !== 200) throw new Error(`Desktop returned status ${response.status}`)
    const job = z.object({ state: z.string() }).parse(response.body)
    if (job.state === 'failed' || job.state === 'cancelled') await database.runAsync("UPDATE delivery_receipts SET response_json=json_remove(response_json,'$.mailboxId') WHERE id=?", captureId)
    if (job.state !== 'succeeded') return false
  }
  return true
}

async function installDeliveredNote(requester: CompanionRequester, retained: { id: string; payload_json: string; response_json: string }) {
  const receipt = linkedReceiptSchema.parse(JSON.parse(retained.response_json))
  if (!await acceptedDeliveryReady(requester, retained.id, receipt)) return
  const database = await openEncryptedDatabase()
  const card = await currentDesktopCard(requester, receipt.sourceId)
  const payload = JSON.parse(retained.payload_json) as IncomingShare
  if (receipt.phonePayload.kind === 'url' && (payload.kind !== 'url' || payload.text !== receipt.phonePayload.text || payload.title !== receipt.phonePayload.title)) {
    await database.runAsync("UPDATE delivery_receipts SET response_json=json_remove(response_json,'$.mailboxId') WHERE id=?", retained.id)
    return
  }
  if (payload.text !== receipt.phonePayload.text || payload.title !== receipt.phonePayload.title) {
    await queueDesktopEdit({ sourceId: card.sourceId, destinationMailboxId: receipt.mailboxId, title: payload.title ?? card.title, text: payload.text, projectId: card.projectId, expectedUpdatedAt: card.updatedAt })
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, receipt.phonePayload.text)
    if (card.sourceId !== receipt.sourceId || card.textSha256 !== digest || card.title !== (receipt.phonePayload.title ?? 'Untitled memory')) await database.runAsync("UPDATE desktop_note_edits SET state='conflict' WHERE source_id=?", card.sourceId)
  }
  await downloadSource(requester, card)
  await withDatabaseTransaction(async database => {
    const removed = await database.runAsync('DELETE FROM local_notes WHERE id=? AND payload_json=?', retained.id, retained.payload_json)
    if (removed.changes === 1) await rebindLearningIdentity(database, { sourceId: retained.id, mailboxId: null }, { sourceId: card.sourceId, mailboxId: requester.mailboxId })
    await database.runAsync('DELETE FROM local_source_links WHERE (source_id=? OR related_source_id=?) AND NOT EXISTS(SELECT 1 FROM local_notes WHERE id=?)', retained.id, retained.id, retained.id)
    await database.runAsync("UPDATE delivery_receipts SET response_json=json_remove(response_json,'$.phonePayload') WHERE id=? AND NOT EXISTS(SELECT 1 FROM local_notes WHERE id=?)", retained.id, retained.id)
  })
}

export async function reconcileDeliveredNotes(requester: CompanionRequester): Promise<boolean> {
  const database = await openEncryptedDatabase()
  const retained = await database.getAllAsync<{ id: string; payload_json: string; response_json: string }>(`SELECT note.id,note.payload_json,receipt.response_json FROM local_notes note JOIN delivery_receipts receipt ON receipt.id=note.id
    WHERE note.kind IN ('note','url') AND receipt.kind=note.kind AND json_extract(receipt.response_json,'$.mailboxId')=? AND json_type(receipt.response_json,'$.phonePayload')='object' ORDER BY note.created_at_ms`, requester.mailboxId)
  for (const note of retained) await installDeliveredNote(requester, note)
  return retained.length > 0
}
