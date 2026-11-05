import type { connectCompanion } from '../../companion/client'
import { reconcileDeliveredNotes } from '../../capture/linkedNotes'
import { listDesktopLibrary, reconcileDownloads } from '../../library/library'
import { pendingDesktopEdits, syncDesktopEdits } from '../../notes/pendingEdits'
import { libraryPageSize, type LibraryScope } from './types'
import { learningIndex, syncLearningEntries } from '../../learning'
import type { LibraryFilters } from '../../library/searchQuery'
import { libraryPageWindow } from '../../library/pageWindow'

type DesktopListing = Pick<Awaited<ReturnType<typeof listDesktopLibrary>>, 'items' | 'totalItems'>

interface DesktopRefreshRequest {
  readonly connection: Awaited<ReturnType<typeof connectCompanion>>
  readonly query: string
  readonly page: number
  readonly pageSize?: number
  readonly phoneTotal?: number
  readonly scope: LibraryScope
  readonly filters?: LibraryFilters
  readonly isCurrent: () => boolean
  readonly publishListing: (listing: DesktopListing) => void
}

async function desktopListing(request: DesktopRefreshRequest): Promise<DesktopListing> {
  if (request.scope === 'phone') return { items: [], totalItems: 0 }
  const window = libraryPageWindow(request.page, request.pageSize ?? libraryPageSize, request.scope === 'all' ? request.phoneTotal ?? 0 : 0).desktop
  const listing = await listDesktopLibrary(request.connection, { ...request.filters, query: request.query, limit: Math.max(1, window.limit), offset: window.offset })
  return { items: window.limit === 0 ? [] : listing.items.slice(0, window.limit), totalItems: listing.totalItems }
}

async function synchronizePhoneChanges(request: DesktopRefreshRequest) {
  const failures: unknown[] = []
  let hadChanges = false
  try {
    hadChanges = await reconcileDeliveredNotes(request.connection)
  } catch (error) {
    failures.push(error)
  }
  if (!request.isCurrent()) return { hadChanges, failures }
  try {
    hadChanges = (await pendingDesktopEdits()).some(edit => edit.state === 'queued') || hadChanges
    if (request.isCurrent()) await syncDesktopEdits(request.connection)
  } catch (error) {
    failures.push(error)
  }
  return { hadChanges, failures }
}

async function refreshOfflineCopies(request: DesktopRefreshRequest) {
  try {
    return { replacements: await reconcileDownloads(request.connection), failures: [] }
  } catch (error) {
    return { replacements: new Map<string, string>(), failures: [error] }
  }
}

async function synchronizePersonalNotes(request: DesktopRefreshRequest, visibleSourceIds: readonly string[]) {
  try {
    const changed = (await learningIndex()).some(entry => entry.identity.mailboxId === request.connection.mailboxId && entry.dirty)
    const summary = await syncLearningEntries(request.connection, visibleSourceIds)
    const failures: unknown[] = []
    if (summary.conflicts > 0) failures.push(new Error('Personal notes changed on both devices. Your phone copy is preserved; open the note to resolve the conflict.'))
    if (summary.failed > 0) failures.push(new Error('Some personal notes could not sync. Your phone copies are preserved.'))
    if (summary.pending > 0) failures.push(new Error('Some personal notes are waiting to sync. They remain saved on this phone.'))
    return { changed, failures }
  } catch (error) {
    return { changed: false, failures: [error] }
  }
}

export async function refreshDesktopLibrary(request: DesktopRefreshRequest) {
  if (!request.isCurrent()) return null
  let listing = await desktopListing(request)
  if (!request.isCurrent()) return null
  request.publishListing(listing)
  if (!request.isCurrent()) return null
  const phoneChanges = await synchronizePhoneChanges(request)
  if (!request.isCurrent()) return null
  const personalNotes = await synchronizePersonalNotes(request, listing.items.map(card => card.sourceId))
  if (!request.isCurrent()) return null
  const failures = [...phoneChanges.failures, ...personalNotes.failures]
  if ((phoneChanges.hadChanges || personalNotes.changed) && request.scope !== 'phone') {
    try {
      listing = await desktopListing(request)
    } catch (error) {
      failures.push(error)
    }
  }
  if (!request.isCurrent()) return null
  request.publishListing(listing)
  if (!request.isCurrent()) return null
  const offlineCopies = await refreshOfflineCopies(request)
  if (!request.isCurrent()) return null
  return { listing, replacements: offlineCopies.replacements, failures: [...failures, ...offlineCopies.failures] }
}
