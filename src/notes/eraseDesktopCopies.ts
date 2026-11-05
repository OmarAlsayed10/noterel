import { removeMemoryLearningInDatabase } from '../learning'
import { withDatabaseTransaction } from '../storage/database'
import type { SQLiteDatabase } from 'expo-sqlite'

async function eraseRetainedPhoneCopies(database: SQLiteDatabase, mailboxId: string, sourceIds: readonly string[]): Promise<void> {
  const placeholders = sourceIds.map(() => '?').join(',')
  const artifacts = await database.getAllAsync<{ id: string }>(`SELECT source_id AS id FROM local_source_artifacts WHERE destination_mailbox_id=? AND desktop_source_id IN (${placeholders})`, mailboxId, ...sourceIds)
  const receipts = await database.getAllAsync<{ id: string }>(`SELECT id FROM delivery_receipts WHERE json_extract(response_json,'$.mailboxId')=? AND json_extract(response_json,'$.sourceId') IN (${placeholders})`, mailboxId, ...sourceIds)
  for (const id of new Set([...artifacts, ...receipts].map(copy => copy.id))) {
    const foreign = await database.getFirstAsync(`SELECT id FROM outbox_operations WHERE id=? AND destination_mailbox_id<>?
      UNION ALL SELECT source_id AS id FROM local_source_artifacts WHERE source_id=? AND (destination_mailbox_id IS NULL OR destination_mailbox_id<>?) LIMIT 1`, id, mailboxId, id, mailboxId)
    if (!foreign) {
      await database.runAsync('DELETE FROM local_source_links WHERE source_id=? OR related_source_id=?', id, id)
      await database.runAsync('DELETE FROM local_notes WHERE id=?', id)
      await database.runAsync('DELETE FROM pending_pdf_imports WHERE id=?', id)
      await database.runAsync('DELETE FROM pending_image_imports WHERE id=?', id)
      await database.runAsync("DELETE FROM memory_learning WHERE origin_id='phone' AND source_id=?", id)
      await database.runAsync('DELETE FROM local_source_artifacts WHERE source_id=? AND destination_mailbox_id=?', id, mailboxId)
    }
    await database.runAsync('DELETE FROM outbox_operations WHERE id=? AND destination_mailbox_id=?', id, mailboxId)
    await database.runAsync("UPDATE delivery_receipts SET response_json=json_remove(response_json,'$.phonePayload') WHERE id=? AND json_extract(response_json,'$.mailboxId')=?", id, mailboxId)
  }
}

export async function eraseDesktopCopies(identity: { readonly sourceId: string; readonly mailboxId: string }): Promise<void> {
  await withDatabaseTransaction(async database => {
    const family = await removeMemoryLearningInDatabase(database, identity)
    for (let offset = 0; offset < family.length; offset += 100) {
      const sourceIds = family.slice(offset, offset + 100)
      const placeholders = sourceIds.map(() => '?').join(',')
      await eraseRetainedPhoneCopies(database, identity.mailboxId, sourceIds)
      await database.runAsync(`DELETE FROM downloaded_sources WHERE mailbox_id=? AND source_id IN (${placeholders})`, identity.mailboxId, ...sourceIds)
      await database.runAsync(`DELETE FROM desktop_note_edits WHERE destination_mailbox_id=? AND source_id IN (${placeholders})`, identity.mailboxId, ...sourceIds)
      await database.runAsync(`DELETE FROM download_staging WHERE json_extract(metadata_json,'$.mailboxId')=? AND source_id IN (${placeholders})`, identity.mailboxId, ...sourceIds)
    }
  })
}
