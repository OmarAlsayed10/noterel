import { emptyLibraryFilters, learningSearchTextSql, librarySearch, type LibraryFilters } from './searchQuery'
import { openEncryptedDatabase } from '../storage/database'
import type { IncomingShare } from '../capture/incomingShare'
import type { QueuedCapture } from '../capture/outbox'
import type { PendingPdf } from '../capture/pdfImports'
import type { PendingImage } from '../capture/imageImports'

type PhoneMemoryPageItem = { readonly type: 'capture'; readonly capture: QueuedCapture } | { readonly type: 'pdf'; readonly pdf: PendingPdf } | { readonly type: 'image'; readonly image: PendingImage }

interface PhoneMemoryRow {
  readonly item_type: 'capture' | 'pdf' | 'image'
  readonly id: string
  readonly operation_key: string
  readonly destination_mailbox_id: string | null
  readonly kind: 'note' | 'url' | null
  readonly payload_json: string | null
  readonly state: QueuedCapture['state'] | PendingPdf['state']
  readonly created_at_ms: number
  readonly retry_count: number
  readonly filename: string | null
  readonly byte_length: number | null
  readonly media_type: PendingImage['mediaType'] | null
  readonly text_content: string | null
  readonly progress_percent: number | null
  readonly progress_stage: string | null
  readonly failure_message: string | null
  readonly desktop_source_id: string | null
}

const phoneMemoryRows = `FROM (
  SELECT 'capture' AS item_type,capture.id,capture.operation_key,capture.destination_mailbox_id,capture.kind,capture.payload_json,capture.state,capture.created_at_ms,capture.updated_at_ms,capture.retry_count,NULL AS filename,NULL AS byte_length,NULL AS media_type,NULL AS text_content,NULL AS progress_percent,NULL AS progress_stage,NULL AS failure_message,NULL AS desktop_source_id
  FROM (SELECT note.id,note.id AS operation_key,coalesce(pending.destination_mailbox_id,json_extract(receipt.response_json,'$.mailboxId')) AS destination_mailbox_id,note.kind,note.payload_json,coalesce(pending.state,'queued') AS state,note.created_at_ms,note.updated_at_ms,coalesce(pending.retry_count,0) AS retry_count
      FROM local_notes note LEFT JOIN outbox_operations pending ON pending.id=note.id LEFT JOIN delivery_receipts receipt ON receipt.id=note.id
    UNION ALL SELECT id,operation_key,destination_mailbox_id,kind,payload_json,state,created_at_ms,created_at_ms AS updated_at_ms,retry_count FROM outbox_operations WHERE id NOT IN (SELECT id FROM local_notes)) capture
  UNION ALL
  SELECT 'pdf' AS item_type,pdf.id,pdf.operation_key,pdf.destination_mailbox_id,NULL,NULL,pdf.state,pdf.created_at_ms,pdf.created_at_ms AS updated_at_ms,0,pdf.filename,pdf.byte_length,NULL,NULL,NULL,NULL,NULL,NULL FROM pending_pdf_imports pdf
  UNION ALL
  SELECT 'image' AS item_type,image.id,image.operation_key,NULL,NULL,NULL,image.state,image.created_at_ms,image.created_at_ms AS updated_at_ms,0,image.filename,image.byte_length,image.media_type,image.text_content,image.progress_percent,image.progress_stage,image.failure_message,image.desktop_source_id FROM pending_image_imports image
) memory LEFT JOIN local_source_artifacts artifact ON artifact.source_id=memory.id
LEFT JOIN memory_learning_aliases alias ON alias.source_id=artifact.desktop_source_id AND alias.origin_id=artifact.destination_mailbox_id
LEFT JOIN memory_learning learning ON learning.source_id=CASE WHEN artifact.desktop_source_id IS NOT NULL AND artifact.destination_mailbox_id IS NOT NULL THEN coalesce(alias.target_source_id,artifact.desktop_source_id) ELSE memory.id END AND learning.origin_id=CASE WHEN artifact.desktop_source_id IS NOT NULL AND artifact.destination_mailbox_id IS NOT NULL THEN artifact.destination_mailbox_id ELSE 'phone' END`

function phoneSearch(query: string, filters: LibraryFilters) {
  return librarySearch(query, filters, {
    text: `coalesce(json_extract(memory.payload_json,'$.title'),'') || ' ' || coalesce(json_extract(memory.payload_json,'$.text'),'') || ' ' || coalesce(memory.filename,'') || ' ' || coalesce(memory.text_content,'') || ' ' || coalesce(json_extract(artifact.metadata_json,'$.title'),'') || ' ' || coalesce(artifact.text_content,'') || ' ' || ${learningSearchTextSql}`,
    kind: `CASE WHEN memory.item_type='capture' THEN CASE WHEN artifact.kind='video' THEN 'video' WHEN memory.kind='note' THEN 'manual_note' ELSE 'url' END ELSE memory.item_type END`,
    time: 'max(memory.updated_at_ms,coalesce(artifact.extracted_at_ms,0))',
    source: "coalesce(artifact.final_url,CASE WHEN memory.kind='url' THEN json_extract(memory.payload_json,'$.text') ELSE '' END)"
  })
}

export async function phoneMemoryCount(query = '', filters: LibraryFilters = emptyLibraryFilters()): Promise<number> {
  const database = await openEncryptedDatabase()
  const search = phoneSearch(query, filters)
  const row = await database.getFirstAsync<{ count: number }>(`SELECT count(*) AS count ${phoneMemoryRows} WHERE ${search.where}`, ...search.parameters)
  return row?.count ?? 0
}

export async function phoneMemoryPage(query = '', limit = 20, offset = 0, filters: LibraryFilters = emptyLibraryFilters()): Promise<readonly PhoneMemoryPageItem[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0) throw new RangeError('Phone memory page is invalid')
  const database = await openEncryptedDatabase()
  const search = phoneSearch(query, filters)
  const rows = await database.getAllAsync<PhoneMemoryRow>(`SELECT memory.* ${phoneMemoryRows} WHERE ${search.where} ORDER BY memory.created_at_ms DESC,memory.id DESC LIMIT ? OFFSET ?`, ...search.parameters, limit, offset)
  return rows.map(phoneMemory)
}

function phoneMemory(row: PhoneMemoryRow): PhoneMemoryPageItem {
    if (row.item_type === 'capture') return { type: 'capture', capture: { id: row.id, operationKey: row.operation_key, destinationMailboxId: row.destination_mailbox_id, kind: row.kind!, payload: JSON.parse(row.payload_json!) as IncomingShare, state: row.state as QueuedCapture['state'], createdAtMs: row.created_at_ms, retryCount: row.retry_count } }
    if (row.item_type === 'pdf') return { type: 'pdf', pdf: { id: row.id, operationKey: row.operation_key, destinationMailboxId: row.destination_mailbox_id, filename: row.filename!, byteLength: row.byte_length!, state: row.state as PendingPdf['state'] } }
    return { type: 'image', image: { id: row.id, operationKey: row.operation_key, filename: row.filename!, mediaType: row.media_type!, byteLength: row.byte_length!, state: row.state as PendingImage['state'], text: row.text_content!, progressPercent: row.progress_percent!, progressStage: row.progress_stage!, failureMessage: row.failure_message, desktopSourceId: row.desktop_source_id, createdAtMs: row.created_at_ms } }
}
