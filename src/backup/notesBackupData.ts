import { insertRestoredCaptures, phoneOnlyCaptures } from '../capture/outbox'
import { importLearningDetails, learningIndex } from '../learning'
import { withDatabaseTransaction } from '../storage/database'
import { notebookBackupSchema, plaintextBackupSchema } from './notesBackupFormat'
import type { PhoneNotesBackup } from './notesBackupFormat'

export async function phoneNotesSnapshot() {
  const captures = await phoneOnlyCaptures()
  const learning = await learningIndex()
  return notebookBackupSchema.parse({ schemaVersion: 2, exportedAt: new Date().toISOString(), captures: captures.map(capture => ({ id: capture.id, payload: capture.payload })), learning: learning.map(entry => ({ identity: entry.identity, details: entry.details })) })
}

export async function restorePhoneNotesSnapshot(input: unknown): Promise<number> {
  const backup: PhoneNotesBackup = plaintextBackupSchema.parse(input)
  return withDatabaseTransaction(async database => {
    const payloads = backup.schemaVersion === 1 ? backup.captures : backup.captures.map(capture => capture.payload)
    const restoredIds = await insertRestoredCaptures(database, payloads)
    if (backup.schemaVersion === 1) return restoredIds.length
    const restored = new Map(backup.captures.map((capture, index) => [capture.id, restoredIds[index]!]))
    for (const entry of backup.learning) {
      const sourceId = entry.identity.mailboxId === null ? restored.get(entry.identity.sourceId) ?? entry.identity.sourceId : entry.identity.sourceId
      await importLearningDetails(database, { ...entry.identity, sourceId }, entry.details)
    }
    return restoredIds.length
  })
}

export async function phoneNotesFingerprint(): Promise<string> {
  const snapshot = await phoneNotesSnapshot()
  return JSON.stringify({ captures: snapshot.captures, learning: snapshot.learning })
}
