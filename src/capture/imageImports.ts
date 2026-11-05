import * as Crypto from 'expo-crypto'
import { File, Paths } from 'expo-file-system'
import { z } from 'zod'
import { openEncryptedDatabase, withDatabaseTransaction } from '../storage/database'
import { base64Url, hexadecimal, sha256 } from '../bytes'
import { artifactEnvelope, uploadEnvelope, type CompanionRequester } from '../sources/artifactTransfer'
import { readableRecognition, unreadableImageMessage } from './readability'

const maximumImageBytes = 12 * 1024 * 1024
const maximumImageStorageBytes = 48 * 1024 * 1024
const maximumExtractedTextBytes = 1024 * 1024
const recognizedImageSchema = z.object({
  engine: z.literal('play-services-ml-kit-text-recognition'),
  engineVersion: z.literal('19.0.1'),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
  text: z.string().max(maximumExtractedTextBytes),
  words: z.array(z.object({ text: z.string().min(1).max(256), left: z.number().min(0).max(1), top: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1), confidence: z.number().min(0).max(1).nullable() }).strict()).max(4096)
}).strict()

export interface ImageCandidate {
  readonly uri: string
  readonly filename: string
  readonly size: number
  readonly mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
}

export interface PendingImage {
  readonly id: string
  readonly operationKey: string
  readonly filename: string
  readonly mediaType: ImageCandidate['mediaType']
  readonly byteLength: number
  readonly state: 'queued' | 'processing' | 'ready' | 'needs_attention'
  readonly text: string
  readonly progressPercent: number
  readonly progressStage: string
  readonly failureMessage: string | null
  readonly desktopSourceId: string | null
  readonly createdAtMs: number
}

const imageExtension = (mediaType: ImageCandidate['mediaType']): string => mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/png' ? 'png' : 'webp'
const normalizedText = (text: string): string => text.replace(/\0/gu, '').replace(/\r/gu, '\n').split('\n').map(line => line.replace(/\t/gu, ' ').replace(/ {2,}/gu, ' ').trim()).filter(Boolean).join('\n')

const verifiedMediaType = (bytes: Uint8Array, mediaType: string): ImageCandidate['mediaType'] => {
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const png = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)
  const webp = bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP'
  if (mediaType === 'image/jpeg' && jpeg || mediaType === 'image/png' && png || mediaType === 'image/webp' && webp) return mediaType
  throw new RangeError('The selected file is not a valid JPEG, PNG, or WebP image')
}

export async function savePendingImage(candidate: ImageCandidate): Promise<PendingImage> {
  if (candidate.size < 12 || candidate.size > maximumImageBytes) throw new RangeError('Choose an image no larger than 12 MiB')
  const bytes = new Uint8Array(await new File(candidate.uri).arrayBuffer())
  if (bytes.byteLength !== candidate.size) throw new RangeError('The selected image changed while it was being read')
  verifiedMediaType(bytes, candidate.mediaType)
  const id = Crypto.randomUUID()
  const operationKey = Crypto.randomUUID()
  await withDatabaseTransaction(async database => {
    const usage = await database.getFirstAsync<{ bytes: number }>('SELECT coalesce(sum(byte_length),0) AS bytes FROM pending_image_imports')
    if (!usage || usage.bytes + bytes.byteLength > maximumImageStorageBytes) throw new RangeError('Encrypted image storage is full')
    const digest = hexadecimal(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes))
    await database.runAsync("INSERT INTO pending_image_imports(id,operation_key,filename,media_type,bytes,byte_length,sha256,state,text_content,text_sha256,metadata_json,progress_percent,progress_stage,failure_message,created_at_ms) VALUES(?,?,?,?,?,?,?,'queued','','','{}',0,'Waiting to read image',NULL,?)", id, operationKey, candidate.filename, candidate.mediaType, bytes, bytes.byteLength, digest, Date.now())
  })
  return { id, operationKey, filename: candidate.filename, mediaType: candidate.mediaType, byteLength: bytes.byteLength, state: 'queued', text: '', progressPercent: 0, progressStage: 'Waiting to read image', failureMessage: null, desktopSourceId: null, createdAtMs: Date.now() }
}

type PendingImageProgress = Pick<PendingImage, 'state' | 'text' | 'progressPercent' | 'progressStage' | 'failureMessage'>

export async function pendingImageProgress(ids: readonly string[]): Promise<ReadonlyMap<string, PendingImageProgress>> {
  if (!ids.length) return new Map()
  const database = await openEncryptedDatabase()
  const rows = await database.getAllAsync<{ id: string; state: PendingImage['state']; text_content: string; progress_percent: number; progress_stage: string; failure_message: string | null }>(`SELECT id,state,text_content,progress_percent,progress_stage,failure_message FROM pending_image_imports WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)
  return new Map(rows.map(row => [row.id, { state: row.state, text: row.text_content, progressPercent: row.progress_percent, progressStage: row.progress_stage, failureMessage: row.failure_message }]))
}

const recognitionTimeoutMilliseconds = 5 * 60 * 1000

async function sendImageForRecognition(requester: CompanionRequester, id: string, image: { readonly operation_key: string; readonly filename: string; readonly bytes: Uint8Array; readonly sha256: string }): Promise<{ readonly sourceId: string; readonly outcome: 'accepted' | 'duplicate' }> {
  const database = await openEncryptedDatabase()
  const started = await requester.request({ method: 'PUT', path: `/api/v1/companion/pdf-imports/${id}`, body: { operationKey: image.operation_key, filename: image.filename, totalBytes: image.bytes.byteLength, sha256: image.sha256 } })
  if (started.status !== 200) throw new Error(`Desktop returned status ${started.status}`)
  let receipt: unknown = null
  for (let offset = 0; offset < image.bytes.byteLength; offset += 24 * 1024) {
    const endOffset = Math.min(offset + 24 * 1024, image.bytes.byteLength)
    const response = await requester.request({ method: 'POST', path: `/api/v1/companion/pdf-imports/${id}/chunks`, body: { offset, bytes: base64Url(image.bytes.subarray(offset, endOffset)) } }, endOffset === image.bytes.byteLength ? recognitionTimeoutMilliseconds : undefined)
    if (response.status < 200 || response.status >= 300) throw new Error(`Desktop returned status ${response.status}`)
    receipt = response.body
  }
  const accepted = z.object({ state: z.literal('accepted'), sourceId: z.string().uuid(), outcome: z.enum(['accepted', 'duplicate']) }).passthrough().safeParse(receipt)
  if (!accepted.success) throw new Error('Desktop could not recognize this image')
  await database.runAsync("UPDATE pending_image_imports SET desktop_source_id=?,state='ready',progress_percent=100,progress_stage='Recognized on Desktop',failure_message=NULL WHERE id=?", accepted.data.sourceId, id)
  return { sourceId: accepted.data.sourceId, outcome: accepted.data.outcome }
}

export async function sendPendingImage(requester: CompanionRequester, id: string): Promise<{ readonly sourceId: string; readonly outcome: 'accepted' | 'duplicate' }> {
  const database = await openEncryptedDatabase()
  const image = await database.getFirstAsync<{ operation_key: string; filename: string; media_type: ImageCandidate['mediaType']; bytes: Uint8Array; sha256: string; text_content: string; text_sha256: string; metadata_json: string; state: PendingImage['state'] }>('SELECT operation_key,filename,media_type,bytes,sha256,text_content,text_sha256,metadata_json,state FROM pending_image_imports WHERE id=?', id)
  if (!image) throw new Error('Pending image is unavailable')
  if (image.state !== 'ready' || !image.text_content) return sendImageForRecognition(requester, id, image)
  const recognition = recognizedImageSchema.parse(JSON.parse(image.metadata_json).recognition)
  const manifest = {
    schemaVersion: 1, sourceId: id, kind: 'image', title: image.filename, text: image.text_content, originalSha256: image.sha256, textSha256: image.text_sha256,
    extractor: recognition.engine, extractorVersion: recognition.engineVersion, extractedAt: new Date().toISOString(), filename: image.filename, mediaType: image.media_type,
    recognition: { engine: recognition.engine, engineVersion: recognition.engineVersion, language: 'und', pages: [{ pageNumber: 1, text: image.text_content, words: recognition.words }] }
  }
  const envelope = artifactEnvelope(manifest, image.bytes)
  const receipt = await uploadEnvelope({ requester, importId: id, operationKey: image.operation_key, kind: 'image', envelope, digest: await sha256(envelope) })
  await database.runAsync('UPDATE pending_image_imports SET desktop_source_id=? WHERE id=?', receipt.sourceId, id)
  return { sourceId: receipt.sourceId, outcome: receipt.outcome }
}

export async function pendingImageCount(): Promise<number> {
  const database = await openEncryptedDatabase()
  const row = await database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM pending_image_imports')
  return row?.count ?? 0
}

export async function discardPendingImage(id: string): Promise<void> {
  const database = await openEncryptedDatabase()
  await database.runAsync('DELETE FROM pending_image_imports WHERE id=?', id)
}

export async function retryPendingImage(id: string): Promise<void> {
  const database = await openEncryptedDatabase()
  await database.runAsync("UPDATE pending_image_imports SET state='queued',progress_percent=0,progress_stage='Waiting to read image',failure_message=NULL WHERE id=? AND state='needs_attention'", id)
}

export async function processNextQueuedImage(): Promise<boolean> {
  const database = await openEncryptedDatabase()
  const image = await database.getFirstAsync<{ id: string; filename: string; media_type: ImageCandidate['mediaType']; bytes: Uint8Array }>("SELECT id,filename,media_type,bytes FROM pending_image_imports WHERE state IN ('queued','processing') ORDER BY created_at_ms,id LIMIT 1")
  if (!image) {
    return false
  }
  const temporary = new File(Paths.cache, `${image.id}.${imageExtension(image.media_type)}`)
  try {
    await database.runAsync("UPDATE pending_image_imports SET state='processing',progress_percent=15,progress_stage='Opening image',failure_message=NULL WHERE id=?", image.id)
    temporary.create({ overwrite: true })
    temporary.write(image.bytes)
    await database.runAsync("UPDATE pending_image_imports SET progress_percent=45,progress_stage='Reading visible text' WHERE id=?", image.id)
    const native = (await import('../../modules/kestrel-source-processing')).default
    const recognition = recognizedImageSchema.parse(await native.recognizeImage(temporary.uri))
    const text = normalizedText(recognition.text)
    if (!text) throw new RangeError('No readable text was found in this image')
    if (!readableRecognition(text, recognition.words)) throw new RangeError(unreadableImageMessage)
    const textBytes = new TextEncoder().encode(text)
    const textSha256 = hexadecimal(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, textBytes))
    await database.runAsync("UPDATE pending_image_imports SET state='ready',text_content=?,text_sha256=?,metadata_json=?,progress_percent=100,progress_stage='Ready',failure_message=NULL WHERE id=?", text, textSha256, JSON.stringify({ title: image.filename, recognition }), image.id)
    return true
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'Image recognition failed').slice(0, 512)
    await database.runAsync("UPDATE pending_image_imports SET state='needs_attention',progress_stage='Recognition failed',failure_message=? WHERE id=?", message, image.id)
    return true
  } finally {
    if (temporary.exists) temporary.delete()
  }
}
