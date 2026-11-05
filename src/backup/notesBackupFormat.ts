import { z } from 'zod'
import { learningDetailsSchema } from '../learning/schema'
import { savedTranscriptionSchema } from '../transcription/source'

export const backupMediaType = 'application/vnd.kestrel.mobile-backup+json'
export const backupAdditionalData = new TextEncoder().encode('kestrel-mobile-notes-backup-v1')
const captureSchema = z.object({ kind: z.enum(['note', 'url']), text: z.string().max(1_048_576), title: z.string().max(512).nullable(), captionLanguage: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/u).optional(), captureMode: z.enum(['reference', 'extract']).optional(), takeaway: z.string().max(8192).optional(), transcription: savedTranscriptionSchema.optional() }).strict().refine(capture => !capture.transcription || capture.kind === 'note', 'Transcription must be saved as a note')
const legacyBackupSchema = z.object({ schemaVersion: z.literal(1), exportedAt: z.string().datetime(), captures: z.array(captureSchema).max(500) }).strict()
const learningBackupSchema = z.object({ identity: z.object({ sourceId: z.string().uuid(), mailboxId: z.string().min(1).max(128).nullable() }).strict(), details: learningDetailsSchema }).strict()
export const notebookBackupSchema = z.object({
  schemaVersion: z.literal(2),
  exportedAt: z.string().datetime(),
  captures: z.array(z.object({ id: z.string().uuid(), payload: captureSchema }).strict()).max(500),
  learning: z.array(learningBackupSchema).max(1500)
}).strict().refine(backup => new Set(backup.captures.map(capture => capture.id)).size === backup.captures.length, 'Backup note identifiers must be unique')
export const plaintextBackupSchema = z.discriminatedUnion('schemaVersion', [legacyBackupSchema, notebookBackupSchema])
export type PhoneNotesBackup = z.infer<typeof plaintextBackupSchema>
export const encryptedBackupSchema = z.object({ schemaVersion: z.literal(1), algorithm: z.literal('AES-256-GCM'), ciphertext: z.string().max(15 * 1024 * 1024) }).strict()
