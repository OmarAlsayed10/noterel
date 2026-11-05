import type { LibraryFilters } from './searchQuery'
import { z } from 'zod'
import { libraryCardSchema, libraryCheckSchema, libraryListingSchema, libraryPageSchema, type MobileResponse } from '../companion/protocol'

export interface DesktopLibraryRequester {
  readonly mailboxId: string
  readonly request: (input: { method: 'GET' | 'POST'; path: string; body: unknown }) => Promise<MobileResponse>
}

export const desktopLibraryBody = (response: MobileResponse): unknown => {
  if (response.status < 200 || response.status >= 300) throw new Error(`Desktop returned status ${response.status}`)
  return response.body
}

export async function listDesktopLibrary(requester: DesktopLibraryRequester, filters: Partial<LibraryFilters> & { query?: string; project?: string; folder?: string; limit?: number; offset?: number; cursor?: string } = {}) {
  const parameters = new URLSearchParams()
  if (filters.query) parameters.set('query', filters.query)
  if (filters.project) parameters.set('project', z.string().uuid().parse(filters.project))
  if (filters.folder) parameters.set('folder', filters.folder)
  if (filters.kind && filters.kind !== 'all') parameters.set('kind', filters.kind)
  if (filters.sinceMs !== undefined && filters.sinceMs !== null) parameters.set('sinceMs', String(filters.sinceMs))
  if (filters.collection) parameters.set('collection', filters.collection)
  if (filters.revisitOnly) parameters.set('revisitOnly', 'true')
  if (filters.source) parameters.set('source', filters.source)
  parameters.set('limit', String(filters.limit ?? 20))
  if (filters.offset) parameters.set('offset', String(filters.offset))
  if (filters.cursor) parameters.set('cursor', filters.cursor)
  const response = await requester.request({ method: 'GET', path: `/api/v1/companion/library?${parameters}`, body: null })
  return libraryListingSchema.parse(desktopLibraryBody(response))
}

export async function currentDesktopCard(requester: DesktopLibraryRequester, sourceId: string) {
  z.string().uuid().parse(sourceId)
  const response = await requester.request({ method: 'POST', path: '/api/v1/companion/library/check', body: { sources: [{ sourceId, revision: '0'.repeat(64) }] } })
  const status = libraryCheckSchema.parse(desktopLibraryBody(response)).find(source => source.sourceId === sourceId)
  if (!status || status.state === 'unavailable') throw new Error('Desktop source is no longer available')
  const current = status.state === 'replaced' ? status.replacement : { sourceId, revision: status.revision }
  const page = await requester.request({ method: 'GET', path: `/api/v1/companion/library/${current.sourceId}?revision=${current.revision}&offset=0`, body: null })
  return libraryCardSchema.strip().parse(libraryPageSchema.parse(desktopLibraryBody(page)))
}
