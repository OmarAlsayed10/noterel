import { currentMailboxId } from '../../companion/client'
import { learningIndex } from '../../learning'
import { localLibrary, localLibraryByIds, localLibraryCount } from '../../library/library'
import { phoneMemoryCount, phoneMemoryPage } from '../../library/phoneMemories'
import type { LibraryFilters } from '../../library/searchQuery'
import { pendingDesktopEdits } from '../../notes/pendingEdits'
import { localExtractionProgress, localSourceArtifactSummaries } from '../../sources/artifacts'
import { libraryPageSize, type LibraryScope } from './types'
import { libraryPageWindow } from '../../library/pageWindow'

export async function loadLocalLibrary({ query, page, filters, desktopSourceIds, pageSize = libraryPageSize, scope = 'all', desktopAvailable = false }: { readonly query: string; readonly page: number; readonly filters: LibraryFilters; readonly desktopSourceIds: readonly string[]; readonly pageSize?: number; readonly scope?: LibraryScope; readonly desktopAvailable?: boolean }) {
  const phoneTotal = scope === 'desktop' ? 0 : await phoneMemoryCount(query, filters)
  const window = libraryPageWindow(page, pageSize, phoneTotal)
  const downloads = !desktopAvailable && window.desktop.limit > 0 ? await localLibrary(query, window.desktop.limit, window.desktop.offset, filters) : []
  const mailboxId = await currentMailboxId()
  const desktopDownloads = desktopAvailable ? await localLibraryByIds(desktopSourceIds, mailboxId) : []
  const phonePage = window.phone.limit > 0 ? await phoneMemoryPage(query, window.phone.limit, window.phone.offset, filters) : []
  const captures = phonePage.flatMap(memory => memory.type === 'capture' ? [memory.capture] : [])
  const pdfs = phonePage.flatMap(memory => memory.type === 'pdf' ? [memory.pdf] : [])
  const images = phonePage.flatMap(memory => memory.type === 'image' ? [memory.image] : [])
  const sourceIds = [...captures.map(capture => capture.id), ...pdfs.map(pdf => pdf.id)]
  const summaries = await localSourceArtifactSummaries(sourceIds)
  const progress = await localExtractionProgress(sourceIds)
  const edits = await pendingDesktopEdits()
  const downloadedTotal = await localLibraryCount(query, filters)
  const learning = await learningIndex()
  const collections = [...new Set(learning.flatMap(entry => entry.details.collections))].sort((left, right) => left.localeCompare(right))
  return { downloads, visibleDownloads: desktopAvailable ? desktopDownloads : downloads, mailboxId, captures, pdfs, images, summaries, progress, edits, phoneTotal, downloadedTotal, collections }
}
