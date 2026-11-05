import type { listDesktopLibrary, localLibrary } from '../../library/library'

export type DesktopLibraryCard = Awaited<ReturnType<typeof listDesktopLibrary>>['items'][number]

export type DownloadedLibraryCard = Awaited<ReturnType<typeof localLibrary>>[number]

export interface ReadingMemory {
  readonly sourceId: string | null
  readonly desktopMailboxId?: string | null
  readonly localSourceId: string | null
  readonly captureId: string | null
  readonly title: string
  readonly text: string
  readonly kind: DesktopLibraryCard['kind'] | 'image'
  readonly mediaType?: string | null
  readonly imageUrls?: readonly string[]
  readonly transcriptionSource?: import('../../transcription/source').VideoSource
  readonly projectId: string | null
  readonly updatedAt: string | null
  readonly stale: boolean
  readonly url: string | null
  readonly sourceSegments?: readonly import('../../learning/anchors').SourceSegment[]
  readonly searchQuery?: string
}

export interface LocalConnection {
  readonly sourceId: string
  readonly captureId: string | null
  readonly title: string
  readonly text: string
  readonly kind: 'pdf' | 'video' | 'manual_note' | 'url'
  readonly url: string | null
  readonly imageUrls?: readonly string[]
  readonly transcriptionSource?: import('../../transcription/source').VideoSource
}

export type LibraryPageSize = 5 | 10 | 20
export const libraryPageSize: LibraryPageSize = 10
export type LibraryScope = 'all' | 'phone' | 'desktop'
