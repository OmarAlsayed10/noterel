import { phoneOnlyCaptures } from '../capture/outbox'
import { pendingPdfs } from '../capture/pdfImports'
import { localLibrary, readDownloadedSource } from '../library/library'
import { localSourceArtifactSummaries } from '../sources/artifacts'
import type { AskContext } from './codexClient'
import { boundedLocalEvidence, rankLocalContextCandidates } from './localContextRanking'

export async function retrieveLocalContexts(query: string): Promise<readonly AskContext[]> {
  const [phoneNotes, pdfs, downloads] = await Promise.all([phoneOnlyCaptures(), pendingPdfs(), localLibrary('', 50)])
  const artifacts = await localSourceArtifactSummaries([...phoneNotes.map(note => note.id), ...pdfs.map(pdf => pdf.id)])
  const ranked = rankLocalContextCandidates(query, [
    ...phoneNotes.map(note => { const artifact = artifacts.get(note.id); return { id: `phone:${note.id}`, title: artifact?.title || note.payload.title || (note.kind === 'url' ? 'Saved link' : 'Phone note'), preview: artifact?.text || note.payload.text, updatedAtMs: artifact?.extractedAtMs ?? note.createdAtMs } }),
    ...pdfs.flatMap(pdf => { const artifact = artifacts.get(pdf.id); return artifact ? [{ id: `phone:${pdf.id}`, title: artifact.title, preview: artifact.text, updatedAtMs: artifact.extractedAtMs }] : [] }),
    ...downloads.map(download => ({ id: `download:${download.sourceId}`, title: download.title, preview: download.excerpt, updatedAtMs: download.downloadedAtMs }))
  ])
  const contexts = await Promise.all(ranked.map(async candidate => {
    if (candidate.id.startsWith('phone:')) return { sourceId: candidate.id, title: candidate.title, text: boundedLocalEvidence(candidate.preview, query) }
    const sourceId = candidate.id.slice(9)
    const source = await readDownloadedSource(sourceId)
    if (!source) return null
    return { sourceId, title: source.metadata.title, text: boundedLocalEvidence(source.text, query) }
  }))
  return contexts.filter((context): context is AskContext => context !== null)
}
