import { z } from 'zod'
import KestrelSourceProcessing from '../../modules/kestrel-source-processing'
import { normalizeIncomingShare, type IncomingShare } from '../capture/incomingShare'
import { restorePhoneOnlyCaptures } from '../capture/outbox'

const maximumArchiveBytes = 64 * 1024 * 1024
const noteImportSchema = z.object({
  kind: z.enum(['archive', 'anki']),
  notes: z.array(z.object({ title: z.string(), text: z.string(), sourcePath: z.string() })).min(1).max(500)
})

export interface NoteImportCandidate {
  readonly filename: string
  readonly kind: 'archive' | 'anki'
  readonly notes: readonly IncomingShare[]
  readonly sourcePaths: readonly string[]
}

export async function readNoteImport(uri: string, filename: string, size: number | undefined): Promise<NoteImportCandidate> {
  if (!Number.isFinite(size) || !size || size > maximumArchiveBytes) throw new RangeError('Choose an archive no larger than 64 MiB')
  const parsed = noteImportSchema.parse(await KestrelSourceProcessing.readNoteImport(uri, filename))
  return {
    filename,
    kind: parsed.kind,
    notes: parsed.notes.map(note => normalizeIncomingShare({ title: note.title, text: note.text })),
    sourcePaths: parsed.notes.map(note => note.sourcePath)
  }
}

export const saveNoteImport = (candidate: NoteImportCandidate): Promise<number> => restorePhoneOnlyCaptures(candidate.notes)
