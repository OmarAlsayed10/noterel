import type { MobileResponse } from '../companion/protocol'
import { openEncryptedDatabase, withDatabaseTransaction } from '../storage/database'
import { downloadSource } from '../library/library'
import { desktopNoteEditTooLarge, isDesktopNoteConflict, replaceDesktopNote } from './desktop'
import { conflictCopyTooLarge } from './conflictCopy'

export interface PendingDesktopEdit {
  readonly sourceId: string
  readonly destinationMailboxId: string | null
  readonly title: string
  readonly text: string
  readonly projectId: string | null
  readonly expectedUpdatedAt: string
  readonly queuedAtMs: number
  readonly tooLarge: boolean
  readonly copyTooLarge: boolean
  readonly state: 'queued' | 'conflict'
}

interface CompanionRequester {
  readonly mailboxId: string
  readonly request: (input: { method: 'PUT' | 'GET' | 'POST'; path: string; body: unknown }) => Promise<MobileResponse>
}

export async function queueDesktopEdit(edit: Omit<PendingDesktopEdit, 'state' | 'queuedAtMs' | 'tooLarge' | 'copyTooLarge'>): Promise<void> {
  const database = await openEncryptedDatabase()
  const origin = await database.getFirstAsync<{ mailbox_id: string | null }>('SELECT destination_mailbox_id AS mailbox_id FROM desktop_note_edits WHERE source_id=? UNION ALL SELECT mailbox_id FROM downloaded_sources WHERE source_id=? LIMIT 1', edit.sourceId, edit.sourceId)
  const destinationMailboxId = origin ? origin.mailbox_id : edit.destinationMailboxId
  const state = !destinationMailboxId || desktopNoteEditTooLarge({ ...edit, updatedAt: edit.expectedUpdatedAt }) ? 'conflict' : 'queued'
  await database.runAsync(`INSERT INTO desktop_note_edits(source_id,title,text_content,project_id,expected_updated_at,state,updated_at_ms,destination_mailbox_id)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET title=excluded.title,text_content=excluded.text_content,destination_mailbox_id=excluded.destination_mailbox_id,
      project_id=excluded.project_id,expected_updated_at=excluded.expected_updated_at,state=excluded.state,
      updated_at_ms=CASE WHEN desktop_note_edits.state='queued' AND desktop_note_edits.title=excluded.title AND desktop_note_edits.text_content=excluded.text_content
        AND desktop_note_edits.project_id IS excluded.project_id AND desktop_note_edits.expected_updated_at=excluded.expected_updated_at AND desktop_note_edits.destination_mailbox_id IS excluded.destination_mailbox_id THEN desktop_note_edits.updated_at_ms
        ELSE max(excluded.updated_at_ms,desktop_note_edits.updated_at_ms+1) END`, edit.sourceId, edit.title, edit.text, edit.projectId, edit.expectedUpdatedAt, state, Date.now(), destinationMailboxId)
}

export async function pendingDesktopEdits(): Promise<readonly PendingDesktopEdit[]> {
  const database = await openEncryptedDatabase()
  const rows = await database.getAllAsync<{ source_id: string; title: string; text_content: string; project_id: string | null; destination_mailbox_id: string | null; expected_updated_at: string; updated_at_ms: number; state: PendingDesktopEdit['state'] }>('SELECT source_id,title,text_content,project_id,destination_mailbox_id,expected_updated_at,updated_at_ms,state FROM desktop_note_edits ORDER BY updated_at_ms')
  return rows.map(row => ({ sourceId: row.source_id, destinationMailboxId: row.destination_mailbox_id, title: row.title, text: row.text_content, projectId: row.project_id, expectedUpdatedAt: row.expected_updated_at, queuedAtMs: row.updated_at_ms, tooLarge: desktopNoteEditTooLarge({ sourceId: row.source_id, title: row.title, text: row.text_content, projectId: row.project_id, updatedAt: row.expected_updated_at }), copyTooLarge: conflictCopyTooLarge({ title: row.title, text: row.text_content }), state: row.state }))
}

export async function removeDesktopEdit(sourceId: string): Promise<void> {
  const database = await openEncryptedDatabase()
  await database.runAsync('DELETE FROM desktop_note_edits WHERE source_id=?', sourceId)
}

async function deliverDesktopEdits(requester: CompanionRequester): Promise<void> {
  for (const edit of await pendingDesktopEdits()) {
    if (edit.state !== 'queued') continue
    if (!edit.destinationMailboxId || edit.destinationMailboxId !== requester.mailboxId) {
      const database = await openEncryptedDatabase()
      await database.runAsync("UPDATE desktop_note_edits SET state='conflict' WHERE source_id=? AND updated_at_ms=?", edit.sourceId, edit.queuedAtMs)
      continue
    }
    try {
      const receipt = await replaceDesktopNote(requester, { sourceId: edit.sourceId, title: edit.title, text: edit.text, projectId: edit.projectId, updatedAt: edit.expectedUpdatedAt, queuedAtMs: edit.queuedAtMs })
      await downloadSource(requester, receipt.card, edit.sourceId)
      await withDatabaseTransaction(async database => {
        await database.runAsync('DELETE FROM desktop_note_edits WHERE source_id=? AND updated_at_ms=? AND state=?', edit.sourceId, edit.queuedAtMs, 'queued')
      })
    } catch (error) {
      if (!isDesktopNoteConflict(error)) throw error
      const database = await openEncryptedDatabase()
      await database.runAsync("UPDATE desktop_note_edits SET state='conflict' WHERE source_id=? AND updated_at_ms=?", edit.sourceId, edit.queuedAtMs)
    }
  }
}

let syncQueue: Promise<unknown> = Promise.resolve()

export function syncDesktopEdits(requester: CompanionRequester): Promise<void> {
  const pending = syncQueue.then(() => deliverDesktopEdits(requester))
  syncQueue = pending.catch(() => undefined)
  return pending
}
