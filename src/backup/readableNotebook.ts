import { emptyLearningDetails, learningDetailsSchema, learningIdentityKey } from '../learning'
import { withDatabaseTransaction } from '../storage/database'
import type { SQLiteDatabase } from 'expo-sqlite'
import { readableMemoryMarkdown } from './readableMarkdown'

interface ExportHeader {
  readonly source_id: string
  readonly local_id: string
  readonly origin_id: string | null
  readonly title: string
  readonly url: string | null
  readonly body_bytes: number
  readonly storage: 'download' | 'capture' | 'artifact' | 'personal'
}

interface PersonalHeader {
  readonly origin_id: string
  readonly source_id: string
  readonly body_bytes: number
}

const maximumExportBytes = 20 * 1024 * 1024
const exportLimitMessage = 'Export exceeds 20 MiB. Export one collection at a time.'
const identityForHeader = (header: { source_id: string; origin_id: string | null }) => ({ sourceId: header.source_id, mailboxId: header.origin_id === 'phone' ? null : header.origin_id })

async function collectionKeys(database: SQLiteDatabase, collection: string): Promise<ReadonlySet<string> | null> {
  if (!collection.trim()) return null
  const rows = await database.getAllAsync<{ origin_id: string; source_id: string }>(`SELECT origin_id,source_id FROM memory_learning learning
    WHERE EXISTS(SELECT 1 FROM json_each(learning.details_json,'$.collections') topic WHERE lower(topic.value)=lower(?))`, collection.trim())
  return new Set(rows.map(row => learningIdentityKey(identityForHeader(row))))
}

async function sourceHeaders(database: SQLiteDatabase): Promise<readonly ExportHeader[]> {
  const downloads = await database.getAllAsync<ExportHeader>(`SELECT coalesce(alias.target_source_id,source.source_id) AS source_id,source.source_id AS local_id,source.mailbox_id AS origin_id,coalesce(edit.title,source.title) AS title,json_extract(source.metadata_json,'$.url') AS url,
    coalesce(length(CAST(edit.text_content AS BLOB)),source.byte_length) AS body_bytes,'download' AS storage FROM downloaded_sources source
    LEFT JOIN desktop_note_edits edit ON edit.source_id=source.source_id AND edit.destination_mailbox_id IS source.mailbox_id
    LEFT JOIN memory_learning_aliases alias ON alias.source_id=source.source_id AND alias.origin_id=source.mailbox_id`)
  const captures = await database.getAllAsync<ExportHeader>(`SELECT coalesce(artifact.desktop_source_id,note.id) AS source_id,note.id AS local_id,
    CASE WHEN artifact.desktop_source_id IS NOT NULL THEN artifact.destination_mailbox_id ELSE NULL END AS origin_id,
    coalesce(json_extract(artifact.metadata_json,'$.title'),json_extract(note.payload_json,'$.title'),'Untitled note') AS title,
    coalesce(artifact.final_url,CASE WHEN note.kind='url' THEN json_extract(note.payload_json,'$.text') ELSE NULL END) AS url,
    length(CAST(coalesce(artifact.text_content,json_extract(note.payload_json,'$.text')) AS BLOB)) AS body_bytes,'capture' AS storage
    FROM local_notes note LEFT JOIN local_source_artifacts artifact ON artifact.source_id=note.id AND artifact.text_sha256<>''`)
  const artifacts = await database.getAllAsync<ExportHeader>(`SELECT coalesce(desktop_source_id,source_id) AS source_id,source_id AS local_id,CASE WHEN desktop_source_id IS NOT NULL THEN destination_mailbox_id ELSE NULL END AS origin_id,
    coalesce(json_extract(metadata_json,'$.title'),'Saved source') AS title,final_url AS url,length(CAST(text_content AS BLOB)) AS body_bytes,'artifact' AS storage
    FROM local_source_artifacts WHERE text_sha256<>'' AND NOT EXISTS(SELECT 1 FROM local_notes note WHERE note.id=local_source_artifacts.source_id)`)
  return [...downloads, ...captures, ...artifacts]
}

async function exportHeaders(database: SQLiteDatabase, collection: string) {
  const selected = await collectionKeys(database, collection)
  const headers = new Map<string, ExportHeader>()
  for (const header of await sourceHeaders(database)) {
    const alias = header.origin_id ? await database.getFirstAsync<{ target_source_id: string }>('SELECT target_source_id FROM memory_learning_aliases WHERE origin_id=? AND source_id=?', header.origin_id, header.source_id) : null
    const canonical = alias ? { ...header, source_id: alias.target_source_id } : header
    const key = learningIdentityKey(identityForHeader(canonical))
    if ((!selected || selected.has(key)) && !headers.has(key)) headers.set(key, canonical)
  }
  const personal = await database.getAllAsync<PersonalHeader>('SELECT origin_id,source_id,length(CAST(details_json AS BLOB)) AS body_bytes FROM memory_learning')
  for (const header of personal) {
    const key = learningIdentityKey(identityForHeader(header))
    if ((!selected || selected.has(key)) && !headers.has(key)) headers.set(key, { ...header, local_id: header.source_id, title: 'Personal notes', url: null, body_bytes: 0, storage: 'personal' })
  }
  const bodyBytes = [...headers.values()].reduce((sum, header) => sum + header.body_bytes, 0)
  const personalBytes = personal.filter(header => headers.has(learningIdentityKey(identityForHeader(header)))).reduce((sum, header) => sum + header.body_bytes, 0)
  if (bodyBytes + personalBytes > maximumExportBytes) throw new RangeError(exportLimitMessage)
  return headers
}

async function sourceText(database: SQLiteDatabase, header: ExportHeader): Promise<string> {
  if (header.storage === 'personal') return `Source identifier: ${header.source_id}`
  const queries = {
    download: `SELECT coalesce(edit.text_content,CAST(source.text_bytes AS TEXT)) AS text FROM downloaded_sources source LEFT JOIN desktop_note_edits edit ON edit.source_id=source.source_id AND edit.destination_mailbox_id IS source.mailbox_id WHERE source.source_id=?`,
    capture: `SELECT coalesce(artifact.text_content,json_extract(note.payload_json,'$.text')) AS text FROM local_notes note LEFT JOIN local_source_artifacts artifact ON artifact.source_id=note.id AND artifact.text_sha256<>'' WHERE note.id=?`,
    artifact: 'SELECT text_content AS text FROM local_source_artifacts WHERE source_id=?'
  }
  const source = await database.getFirstAsync<{ text: string }>(queries[header.storage], header.local_id)
  if (!source) throw new Error('A note changed during export. Try again.')
  return source.text
}

export async function readableNotebook(collection = ''): Promise<{ contents: string; count: number }> {
  return withDatabaseTransaction(async database => {
    const sections: string[] = []
    let bytes = 0
    for (const header of (await exportHeaders(database, collection)).values()) {
      const identity = identityForHeader(header)
      const personal = await database.getFirstAsync<{ details_json: string }>('SELECT details_json FROM memory_learning WHERE origin_id=? AND source_id=?', identity.mailboxId ?? 'phone', identity.sourceId)
      const details = personal ? learningDetailsSchema.parse(JSON.parse(personal.details_json)) : emptyLearningDetails()
      const section = readableMemoryMarkdown({ identity, title: header.title, url: header.url, text: await sourceText(database, header) }, details)
      bytes += new TextEncoder().encode(section).byteLength + (sections.length ? 9 : 0)
      if (bytes > maximumExportBytes) throw new RangeError(exportLimitMessage)
      sections.push(section)
    }
    return { contents: sections.join('\n\n---\n\n'), count: sections.length }
  })
}
