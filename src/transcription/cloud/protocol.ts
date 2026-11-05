import { z } from 'zod'
import { transcriptionOriginSchema } from '../source'

export const cloudAccountSchema = z.object({
  accountId: z.string().uuid(),
  remainingSeconds: z.number().nonnegative(),
  reservedSeconds: z.number().nonnegative(),
  expiresAt: z.string().datetime()
})

export const cloudJobSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(['queued', 'transcribing', 'succeeded', 'failed']),
  progress: z.number().int().min(0).max(100),
  uploadAccepted: z.boolean(),
  title: z.string().max(512).nullable().optional(),
  text: z.string().max(1024 * 1024).nullable().optional(),
  durationSeconds: z.number().positive().max(600).nullable().optional(),
  error: z.string().max(2048).nullable().optional(),
  errorCode: z.string().max(80).nullable().optional()
})

export const storedCloudJobSchema = z.object({
  id: z.string().uuid(),
  endpoint: z.string(),
  accountId: z.string().uuid(),
  filename: z.string().max(512),
  language: z.enum(['auto', 'ar', 'en']),
  origin: transcriptionOriginSchema.optional(),
  audioUri: z.string().nullable(),
  uploadPending: z.boolean(),
  uploadError: z.string().max(2048).nullable().optional(),
  job: cloudJobSchema,
  createdAt: z.number()
})

export type CloudAccount = z.infer<typeof cloudAccountSchema>
export type CloudJob = z.infer<typeof cloudJobSchema>
export type StoredCloudJob = z.infer<typeof storedCloudJobSchema>

export function cloudEndpoint(candidate: string): string {
  const url = new URL(candidate.trim())
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new RangeError('Use an HTTPS server address without a path, login, query or fragment')
  return url.origin
}
