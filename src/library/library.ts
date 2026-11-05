import { emptyLibraryFilters, learningSearchTextSql, librarySearch, type LibraryFilters } from './searchQuery'
import { z } from 'zod'
import { libraryCardSchema, libraryCheckSchema } from '../companion/protocol'
import { openEncryptedDatabase } from '../storage/database'
import { desktopLibraryBody, type DesktopLibraryRequester } from './desktopLibrary'
import { refreshDownloadedSource } from './sourceDownloads'

const sourceIdSchema = z.string().uuid()

export { currentDesktopCard, listDesktopLibrary } from './desktopLibrary'
export { downloadSource, refreshDownloadedSource } from './sourceDownloads'

async function reconcileDownloadBatch(requester: DesktopLibraryRequester, cached: readonly { source_id: string; revision: string }[]) {
  const response = await requester.request({ method: 'POST', path: '/api/v1/companion/library/check', body: { sources: cached.map(source => ({ sourceId: source.source_id, revision: source.revision })) } })
  const results = libraryCheckSchema.parse(desktopLibraryBody(response))
  const database = await openEncryptedDatabase()
  const replacements = new Map<string, string>()
  for (const result of results) {
    if (result.state === 'unchanged') {
      await database.runAsync('UPDATE downloaded_sources SET stale=0,available_revision=NULL WHERE source_id=? AND revision=?', result.sourceId, result.revision)
      continue
    }
    const revision = result.state === 'changed' ? result.revision : result.state === 'replaced' ? result.replacement.revision : null
    await database.runAsync('UPDATE downloaded_sources SET stale=1,available_revision=? WHERE source_id=?', revision, result.sourceId)
    if (result.state === 'unavailable') continue
    const pending = await database.getFirstAsync('SELECT source_id FROM desktop_note_edits WHERE source_id=?', result.sourceId)
    if (pending) continue
    await refreshDownloadedSource(requester, result.sourceId, result.state === 'replaced' ? result.replacement.sourceId : result.sourceId)
    if (result.state === 'replaced') replacements.set(result.sourceId, result.replacement.sourceId)
  }
  return replacements
}

export async function reconcileDownloads(requester: DesktopLibraryRequester): Promise<ReadonlyMap<string, string>> {
  const database = await openEncryptedDatabase()
  const cached = await database.getAllAsync<{ source_id: string; revision: string }>('SELECT source_id,revision FROM downloaded_sources WHERE mailbox_id=? ORDER BY source_id', requester.mailboxId)
  const replacements = new Map<string, string>()
  for (let offset = 0; offset < cached.length; offset += 100) {
    const batch = await reconcileDownloadBatch(requester, cached.slice(offset, offset + 100))
    batch.forEach((replacement, sourceId) => replacements.set(sourceId, replacement))
  }
  return replacements
}

const downloadedLearningJoin = `FROM downloaded_sources download
  LEFT JOIN memory_learning_aliases alias ON alias.source_id=download.source_id AND alias.origin_id=download.mailbox_id
  LEFT JOIN memory_learning learning ON learning.source_id=coalesce(alias.target_source_id,download.source_id) AND learning.origin_id=coalesce(download.mailbox_id,'phone')`

function downloadedSearch(query: string, filters: LibraryFilters) {
  return librarySearch(query, filters, { text: `download.title || ' ' || CAST(download.text_bytes AS TEXT) || ' ' || coalesce(json_extract(download.metadata_json,'$.url'),'') || ' ' || ${learningSearchTextSql}`, kind: `CASE WHEN json_extract(download.metadata_json,'$.mediaType') LIKE 'image/%' THEN 'image' ELSE json_extract(download.metadata_json,'$.kind') END`, time: "CAST((julianday(json_extract(download.metadata_json,'$.updatedAt'))-2440587.5)*86400000+0.5 AS INTEGER)", source: "json_extract(download.metadata_json,'$.url')" })
}

export async function localLibraryCount(query = '', filters: LibraryFilters = emptyLibraryFilters()): Promise<number> {
  const database = await openEncryptedDatabase()
  const search = downloadedSearch(query, filters)
  const row = await database.getFirstAsync<{ count: number }>(`SELECT count(*) AS count ${downloadedLearningJoin} WHERE ${search.where}`, ...search.parameters)
  return row?.count ?? 0
}

export async function localLibrary(query = '', limit = 20, offset = 0, filters: LibraryFilters = emptyLibraryFilters()): Promise<readonly { sourceId: string; title: string; excerpt: string; downloadedAtMs: number; stale: boolean; folderName: string | null; relativePath: string | null; mailboxId: string | null }[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0) throw new RangeError('Local library page is invalid')
  const database = await openEncryptedDatabase()
  const search = downloadedSearch(query, filters)
  const rows = await database.getAllAsync<{ source_id: string; title: string; excerpt: string; downloaded_at_ms: number; stale: number; metadata_json: string; mailbox_id: string | null }>(`SELECT download.source_id,download.title,download.excerpt,download.downloaded_at_ms,download.stale,download.metadata_json,download.mailbox_id ${downloadedLearningJoin}
    WHERE ${search.where} ORDER BY download.downloaded_at_ms DESC,download.source_id LIMIT ? OFFSET ?`, ...search.parameters, limit, offset)
  return rows.map(row => {
    const metadata = libraryCardSchema.parse(JSON.parse(row.metadata_json))
    return { sourceId: row.source_id, title: row.title, excerpt: row.excerpt, downloadedAtMs: row.downloaded_at_ms, stale: row.stale === 1, folderName: metadata.folderName, relativePath: metadata.relativePath, mailboxId: row.mailbox_id }
  })
}

export async function localLibraryByIds(sourceIds: readonly string[], mailboxId: string | null): Promise<readonly { sourceId: string; title: string; excerpt: string; downloadedAtMs: number; stale: boolean; folderName: string | null; relativePath: string | null; mailboxId: string | null }[]> {
  if (sourceIds.length === 0) return []
  sourceIds.forEach(sourceId => sourceIdSchema.parse(sourceId))
  const database = await openEncryptedDatabase()
  const rows: { source_id: string; title: string; excerpt: string; downloaded_at_ms: number; stale: number; metadata_json: string; mailbox_id: string | null }[] = []
  for (let offset = 0; offset < sourceIds.length; offset += 100) {
    const sourceIdBatch = sourceIds.slice(offset, offset + 100)
    const placeholders = sourceIdBatch.map(() => '?').join(',')
    rows.push(...await database.getAllAsync<{ source_id: string; title: string; excerpt: string; downloaded_at_ms: number; stale: number; metadata_json: string; mailbox_id: string | null }>(`SELECT source_id,title,excerpt,downloaded_at_ms,stale,metadata_json,mailbox_id FROM downloaded_sources WHERE source_id IN (${placeholders}) AND mailbox_id IS ?`, ...sourceIdBatch, mailboxId))
  }
  return rows.map(row => {
    const metadata = libraryCardSchema.parse(JSON.parse(row.metadata_json))
    return { sourceId: row.source_id, title: row.title, excerpt: row.excerpt, downloadedAtMs: row.downloaded_at_ms, stale: row.stale === 1, folderName: metadata.folderName, relativePath: metadata.relativePath, mailboxId: row.mailbox_id }
  })
}

export async function readDownloadedSource(sourceId: string): Promise<{ metadata: z.infer<typeof libraryCardSchema>; text: string; downloadedAtMs: number; stale: boolean; mailboxId: string | null } | null> {
  sourceIdSchema.parse(sourceId)
  const database = await openEncryptedDatabase()
  const row = await database.getFirstAsync<{ metadata_json: string; text_bytes: Uint8Array; downloaded_at_ms: number; stale: number; mailbox_id: string | null }>('SELECT metadata_json,text_bytes,downloaded_at_ms,stale,mailbox_id FROM downloaded_sources WHERE source_id=?', sourceId)
  if (!row) return null
  return { metadata: libraryCardSchema.parse(JSON.parse(row.metadata_json)), text: new TextDecoder('utf-8', { fatal: true }).decode(row.text_bytes), downloadedAtMs: row.downloaded_at_ms, stale: row.stale === 1, mailboxId: row.mailbox_id }
}
