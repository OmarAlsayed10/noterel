import * as Crypto from 'expo-crypto'
import { openEncryptedDatabase, withDatabaseTransaction } from '../storage/database'
import { libraryCardSchema, libraryPageSchema, mobileSourceMaximumBytes } from '../companion/protocol'
import { z } from 'zod'
import { rebindLearningIdentity } from '../learning'

const maximumCacheBytes = 100 * 1024 * 1024
const encoder = new TextEncoder()

type LibraryCard = z.infer<typeof libraryCardSchema>
type DownloadDatabase = Awaited<ReturnType<typeof openEncryptedDatabase>>

interface DownloadStage {
  readonly revision: string
  readonly text_sha256: string
  readonly metadata_json: string
  readonly text_bytes: Uint8Array
  readonly next_offset: number
  readonly total_bytes: number
}

const stagedMetadataSchema = z.object({ mailboxId: z.string(), card: libraryCardSchema, pageCard: libraryCardSchema.optional() }).strict()

function stageMetadata(metadataJson: string) {
  try {
    const metadata = stagedMetadataSchema.safeParse(JSON.parse(metadataJson))
    return metadata.success ? metadata.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

async function assertDownloadCapacity(database: DownloadDatabase, sourceId: string, replacesSourceId: string, storedBytes: number): Promise<void> {
  const usage = await database.getFirstAsync<{ bytes: number }>(`SELECT coalesce(sum(byte_length + length(CAST(metadata_json AS BLOB)) + length(CAST(title AS BLOB)) + length(CAST(excerpt AS BLOB))),0) AS bytes
    FROM downloaded_sources WHERE source_id NOT IN (?,?)`, sourceId, replacesSourceId)
  if (!usage || usage.bytes + storedBytes > maximumCacheBytes) throw new RangeError('Offline library is full')
}

function resumableStage(stage: DownloadStage, card: LibraryCard, metadataJson: string): boolean {
  const metadata = stageMetadata(stage.metadata_json)
  return stage.revision === card.revision && stage.text_sha256 === card.textSha256
    && metadata !== null && JSON.stringify({ mailboxId: metadata.mailboxId, card: metadata.card }) === metadataJson && stage.total_bytes === card.byteLength
    && Number.isInteger(stage.next_offset) && stage.next_offset >= 0 && stage.next_offset <= card.byteLength
    && stage.text_bytes.byteLength === stage.next_offset
}

const decodeBase64Url = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const decoded = atob(padded)
  return Uint8Array.from(decoded, character => character.charCodeAt(0))
}

export async function beginSourceDownload(cardInput: unknown, replacesSourceId: string, mailboxId: string): Promise<number | null> {
  const card = libraryCardSchema.parse(cardInput)
  if (!card.downloadEligible || card.byteLength > mobileSourceMaximumBytes) throw new RangeError('Source is not eligible for download')
  const metadataJson = JSON.stringify({ mailboxId, card })
  const metadataBytes = encoder.encode(metadataJson).byteLength
  const titleBytes = encoder.encode(card.title).byteLength
  const reservedExcerptBytes = Math.min(card.byteLength, 1680)
  return withDatabaseTransaction(async database => {
    await assertDownloadCapacity(database, card.sourceId, replacesSourceId, card.byteLength + metadataBytes + titleBytes + reservedExcerptBytes)
    await database.runAsync('DELETE FROM download_staging WHERE source_id<>?', card.sourceId)
    const stage = await database.getFirstAsync<DownloadStage>('SELECT revision,text_sha256,metadata_json,text_bytes,next_offset,total_bytes FROM download_staging WHERE source_id=?', card.sourceId)
    if (stage && resumableStage(stage, card, metadataJson)) return stage.next_offset === card.byteLength ? null : stage.next_offset
    await database.runAsync(`INSERT INTO download_staging(source_id,revision,text_sha256,metadata_json,text_bytes,next_offset,total_bytes)
      VALUES(?,?,?,?,?,0,?)
      ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision,text_sha256=excluded.text_sha256,metadata_json=excluded.metadata_json,text_bytes=excluded.text_bytes,next_offset=0,total_bytes=excluded.total_bytes`, card.sourceId, card.revision, card.textSha256, metadataJson, new Uint8Array(), card.byteLength)
    return card.byteLength === 0 ? null : 0
  })
}

export async function appendSourcePage(pageInput: unknown): Promise<number | null> {
  const page = libraryPageSchema.parse(pageInput)
  const bytes = decodeBase64Url(page.bytes)
  await withDatabaseTransaction(async database => {
    const stage = await database.getFirstAsync<DownloadStage>('SELECT revision,text_sha256,metadata_json,next_offset,total_bytes,text_bytes FROM download_staging WHERE source_id=?', page.sourceId)
    if (!stage || stage.revision !== page.revision || stage.text_sha256 !== page.textSha256 || stage.next_offset !== page.offset || stage.total_bytes !== page.totalBytes || page.byteLength !== stage.total_bytes || stage.text_bytes.byteLength !== stage.next_offset) throw new Error('Download page does not match the staged source')
    if (bytes.byteLength > 24 * 1024 || (bytes.byteLength === 0 && page.offset < page.totalBytes) || page.offset + bytes.byteLength > page.totalBytes || page.nextOffset !== (page.offset + bytes.byteLength === page.totalBytes ? null : page.offset + bytes.byteLength)) throw new RangeError('Download page boundary is invalid')
    const combined = new Uint8Array(stage.text_bytes.byteLength + bytes.byteLength)
    combined.set(stage.text_bytes)
    combined.set(bytes, stage.text_bytes.byteLength)
    const metadata = stageMetadata(stage.metadata_json)
    if (!metadata) throw new Error('Download metadata is invalid')
    const metadataJson = JSON.stringify({ ...metadata, pageCard: metadata.pageCard ?? libraryCardSchema.strip().parse(page) })
    await database.runAsync('UPDATE download_staging SET text_bytes=?,next_offset=?,metadata_json=? WHERE source_id=?', combined, page.offset + bytes.byteLength, metadataJson, page.sourceId)
  })
  return page.nextOffset
}

async function verifiedDownload(stage: DownloadStage, sourceId: string, mailboxId: string) {
  const staged = stagedMetadataSchema.parse(JSON.parse(stage.metadata_json))
  const metadata = staged.pageCard ?? staged.card
  const origin = staged.mailboxId
  if (origin !== mailboxId || metadata.sourceId !== sourceId || metadata.revision !== stage.revision || metadata.textSha256 !== stage.text_sha256 || metadata.byteLength !== stage.total_bytes || stage.text_bytes.byteLength !== stage.total_bytes) throw new Error('Download metadata does not match the staged source')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(stage.text_bytes)
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text)
  if (digest !== stage.text_sha256) throw new Error('Downloaded source digest does not match')
  return { metadata, text }
}

export async function finishSourceDownload(sourceId: string, replacesSourceId: string, mailboxId: string): Promise<LibraryCard> {
  const database = await openEncryptedDatabase()
  const stage = await database.getFirstAsync<DownloadStage>('SELECT revision,text_sha256,metadata_json,text_bytes,next_offset,total_bytes FROM download_staging WHERE source_id=?', sourceId)
  if (!stage || stage.next_offset !== stage.total_bytes) throw new Error('Download is incomplete')
  const { metadata, text } = await verifiedDownload(stage, sourceId, mailboxId).catch(async error => {
    await database.runAsync('DELETE FROM download_staging WHERE source_id=?', sourceId)
    throw error
  })
  const metadataJson = JSON.stringify(metadata)
  const excerpt = [...text].slice(0, 420).join('')
  const storedBytes = stage.total_bytes + encoder.encode(metadataJson).byteLength + encoder.encode(metadata.title).byteLength + encoder.encode(excerpt).byteLength
  await withDatabaseTransaction(async database => {
    await assertDownloadCapacity(database, sourceId, replacesSourceId, storedBytes)
    await database.runAsync(`INSERT INTO downloaded_sources(source_id,revision,text_sha256,metadata_json,title,excerpt,text_bytes,byte_length,downloaded_at_ms,stale,available_revision,pinned,mailbox_id)
      VALUES(?,?,?,?,?,?,?,?,?,0,NULL,1,?)
      ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision,text_sha256=excluded.text_sha256,metadata_json=excluded.metadata_json,title=excluded.title,excerpt=excluded.excerpt,text_bytes=excluded.text_bytes,byte_length=excluded.byte_length,downloaded_at_ms=excluded.downloaded_at_ms,mailbox_id=excluded.mailbox_id,stale=0,available_revision=NULL`, sourceId, stage.revision, stage.text_sha256, metadataJson, metadata.title, excerpt, stage.text_bytes, stage.total_bytes, Date.now(), mailboxId)
    await database.runAsync('DELETE FROM download_staging WHERE source_id=?', sourceId)
    if (replacesSourceId !== sourceId) {
      await rebindLearningIdentity(database, { sourceId: replacesSourceId, mailboxId }, { sourceId, mailboxId })
      await database.runAsync('DELETE FROM downloaded_sources WHERE source_id=?', replacesSourceId)
    }
  })
  return metadata
}

export async function removeDownloadedSource(sourceId: string): Promise<void> {
  const database = await openEncryptedDatabase()
  await database.runAsync('DELETE FROM downloaded_sources WHERE source_id=?', sourceId)
  await database.runAsync('DELETE FROM download_staging WHERE source_id=?', sourceId)
}
