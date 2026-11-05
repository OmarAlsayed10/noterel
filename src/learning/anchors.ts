import { z } from 'zod'
import { openEncryptedDatabase } from '../storage/database'
import { safeHttpUrl } from '../links'
import type { LearningAnnotation, MemoryIdentity } from './schema'

export const sourceSegmentSchema = z.object({ startMs: z.number().int().min(0).max(86_400_000), endMs: z.number().nonnegative(), startByte: z.number().int().nonnegative(), endByte: z.number().int().nonnegative() }).passthrough()
export type SourceSegment = z.infer<typeof sourceSegmentSchema>

export async function memorySourceSegments(identity: MemoryIdentity): Promise<readonly SourceSegment[]> {
  if (identity.mailboxId) return []
  const database = await openEncryptedDatabase()
  const artifact = await database.getFirstAsync<{ metadata_json: string }>('SELECT metadata_json FROM local_source_artifacts WHERE source_id=?', identity.sourceId)
  if (!artifact) return []
  const metadata = JSON.parse(artifact.metadata_json) as { segments?: unknown }
  const segments = z.array(sourceSegmentSchema).safeParse(metadata.segments)
  return segments.success ? segments.data : []
}

export function assertAnnotationAnchor(annotation: LearningAnnotation, sourceText: string, segments: readonly SourceSegment[]): void {
  if (annotation.quote && (!sourceText.includes(annotation.quote) || sourceText.indexOf(annotation.quote) !== sourceText.lastIndexOf(annotation.quote))) throw new RangeError('Choose a unique quoted passage from this source')
  if (annotation.startMs !== null && !segments.some(segment => segment.startMs === annotation.startMs)) throw new RangeError('Choose an available video moment')
}

export function annotationAvailable(annotation: LearningAnnotation, sourceText: string, segments: readonly SourceSegment[]): boolean {
  return (!annotation.quote || sourceText.includes(annotation.quote) && sourceText.indexOf(annotation.quote) === sourceText.lastIndexOf(annotation.quote)) && (annotation.startMs === null || segments.some(segment => segment.startMs === annotation.startMs))
}

export function annotationSourceUrl(sourceUrl: string | null, startMs: number): string | null {
  const url = safeHttpUrl(sourceUrl)
  if (!url) return null
  if (url.hostname === 'youtu.be' || /(^|\.)youtube\.com$/u.test(url.hostname)) {
    url.searchParams.set('t', `${Math.floor(startMs / 1000)}s`)
    return url.toString()
  }
  return null
}

export const segmentLabel = (milliseconds: number): string => `${Math.floor(milliseconds / 60_000)}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}`
