import { z } from 'zod'

const sourceUrlSchema = z.url().max(2048).refine(value => {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    return false
  }
}, 'Video source URL is invalid')

export const videoSourceSchema = z.object({
  url: sourceUrlSchema,
  title: z.string().max(512).nullable().optional(),
  thumbnailUrl: sourceUrlSchema.refine(value => value.startsWith('https:')).nullable().optional()
}).strict()

export const transcriptionOriginSchema = videoSourceSchema.extend({
  captureId: z.string().uuid().optional(),
  capturePayloadSha256: z.string().regex(/^[0-9a-f]{64}$/u).optional()
}).refine(origin => Boolean(origin.captureId) === Boolean(origin.capturePayloadSha256), 'Video recovery identity is incomplete')

export const savedTranscriptionSchema = z.object({ jobId: z.string().uuid(), source: videoSourceSchema.optional() }).strict()

export type TranscriptionOrigin = z.infer<typeof transcriptionOriginSchema>
export type SavedTranscription = z.infer<typeof savedTranscriptionSchema>
export type VideoSource = z.infer<typeof videoSourceSchema>

export function decodeTranscriptionOrigin(originJson: string): TranscriptionOrigin | null {
  let candidate: unknown
  try {
    candidate = JSON.parse(originJson)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return null
  }
  const origin = transcriptionOriginSchema.safeParse(candidate)
  return origin.success ? origin.data : null
}
