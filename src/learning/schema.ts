import { z } from 'zod'

const utf8 = (maximum: number) => z.string().refine(text => new TextEncoder().encode(text).byteLength <= maximum, 'Personal text exceeds the supported size')

export const learningAnnotationSchema = z.object({
  id: z.string().uuid(),
  note: utf8(8192).refine(text => text.trim().length > 0),
  quote: utf8(2048).refine(text => text.length > 0).nullable(),
  startMs: z.number().int().min(0).max(86_400_000).nullable(),
  createdAtMs: z.number().int().nonnegative()
}).strict()

export const learningDetailsSchema = z.object({
  takeaway: utf8(8192),
  collections: z.array(z.string().trim().min(1).max(64)).max(12).refine(names => new Set(names.map(name => name.toLocaleLowerCase())).size === names.length, 'Collection names must be unique'),
  revisit: z.boolean(),
  annotations: z.array(learningAnnotationSchema).max(100).refine(notes => new Set(notes.map(note => note.id)).size === notes.length, 'Annotation identifiers must be unique')
}).strict().refine(details => new TextEncoder().encode(JSON.stringify({ expectedRevision: Number.MAX_SAFE_INTEGER, details })).byteLength <= 56 * 1024, 'Personal notes exceed the sync message limit')

export const learningEnvelopeSchema = z.object({ sourceId: z.string().uuid(), revision: z.number().int().nonnegative(), details: learningDetailsSchema }).strict()

export interface MemoryIdentity {
  readonly sourceId: string
  readonly mailboxId: string | null
}

export type LearningDetails = z.infer<typeof learningDetailsSchema>
export type LearningAnnotation = z.infer<typeof learningAnnotationSchema>
export type LearningEnvelope = z.infer<typeof learningEnvelopeSchema>

export interface MemoryLearningEntry {
  readonly identity: MemoryIdentity
  readonly details: LearningDetails
  readonly revision: number
  readonly dirty: boolean
  readonly conflict: boolean
  readonly remote: LearningEnvelope | null
  readonly updatedAtMs: number
}

export const emptyLearningDetails = (): LearningDetails => ({ takeaway: '', collections: [], revisit: false, annotations: [] })
export const learningIdentityKey = (identity: MemoryIdentity): string => `${identity.mailboxId ?? 'phone'}:${identity.sourceId}`
