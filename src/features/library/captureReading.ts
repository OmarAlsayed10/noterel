import type { QueuedCapture } from '../../capture/outbox'
import type { LocalSourceArtifactSummary } from '../../sources/artifacts'
import type { ReadingMemory } from './types'

export function captureReading(capture: QueuedCapture, artifact: LocalSourceArtifactSummary | undefined, content: { readonly title: string; readonly text: string; readonly query: string }): ReadingMemory {
  return {
    sourceId: null,
    searchQuery: content.query,
    localSourceId: capture.id,
    captureId: capture.id,
    title: content.title,
    text: content.text,
    kind: artifact?.kind === 'video' ? 'video' : capture.kind === 'note' ? 'manual_note' : 'url',
    projectId: null,
    updatedAt: null,
    stale: false,
    url: artifact?.finalUrl ?? (capture.kind === 'url' ? capture.payload.text : null),
    imageUrls: Array.isArray(artifact?.metadata.imageUrls) ? artifact.metadata.imageUrls.filter((url): url is string => typeof url === 'string') : [],
    transcriptionSource: capture.payload.transcription?.source
  }
}
