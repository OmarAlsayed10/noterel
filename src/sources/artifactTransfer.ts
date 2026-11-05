import * as Crypto from 'expo-crypto'
import type { SQLiteDatabase } from 'expo-sqlite'
import { z } from 'zod'
import type { MobileResponse } from '../companion/protocol'
import { openEncryptedDatabase, withDatabaseTransaction } from '../storage/database'
import { rebindLearningIdentity } from '../learning'
import { localSourceArtifact, type LocalSourceArtifact } from './artifacts'
import { base64Url, sha256 } from '../bytes'

export interface CompanionRequester {
  readonly request: (input: { method: 'PUT' | 'POST'; path: string; body: unknown }, responseTimeoutMilliseconds?: number) => Promise<MobileResponse>
}

const acceptedReceiptSchema = z.object({ state: z.literal('accepted'), sourceId: z.string().uuid(), jobId: z.string().uuid().nullable(), outcome: z.enum(['accepted', 'duplicate']) }).passthrough()
const stagingReceiptSchema = z.object({ nextOffset: z.number().int().min(0).max(20 * 1024 * 1024), state: z.literal('staging').optional() }).passthrough()
const chunkReceiptSchema = z.union([acceptedReceiptSchema, stagingReceiptSchema])
const pdfMetadataSchema = z.object({ filename: z.string(), recognition: z.unknown() }).passthrough()
const urlMetadataSchema = z.object({ description: z.string().nullable(), siteName: z.string().nullable(), thumbnailUrl: z.string().nullable(), mediaType: z.enum(['text/html', 'text/plain']), imageUrls: z.array(z.string()).optional() }).passthrough()
const videoMetadataSchema = z.object({ provider: z.enum(['youtube', 'tiktok', 'facebook']).optional(), videoId: z.string(), channel: z.string(), durationMs: z.number(), captionLanguage: z.string().nullable(), segments: z.array(z.unknown()), thumbnail: z.object({ mediaType: z.enum(['image/jpeg', 'image/webp', 'image/png']), base64: z.string() }).optional(), imageUrls: z.array(z.string()).optional() }).passthrough()

const artifactManifest = (artifact: LocalSourceArtifact): Readonly<Record<string, unknown>> => {
  const common = { schemaVersion: 1, sourceId: artifact.sourceId, kind: artifact.kind, title: artifact.title, text: artifact.text, originalSha256: artifact.originalSha256, textSha256: artifact.textSha256, extractor: artifact.extractor, extractorVersion: artifact.extractorVersion, extractedAt: new Date(artifact.extractedAtMs).toISOString() }
  if (artifact.kind === 'pdf') {
    const metadata = pdfMetadataSchema.parse(artifact.metadata)
    return { ...common, filename: metadata.filename, recognition: metadata.recognition }
  }
  if (!artifact.requestedUrl || !artifact.finalUrl) throw new Error('Processed source URL metadata is incomplete')
  if (artifact.kind === 'video') {
    const metadata = videoMetadataSchema.parse(artifact.metadata)
    return { ...common, provider: metadata.provider ?? 'youtube', videoId: metadata.videoId, requestedUrl: artifact.requestedUrl, canonicalUrl: artifact.finalUrl, channel: metadata.channel, durationMs: metadata.durationMs, captionLanguage: metadata.captionLanguage, segments: metadata.segments, thumbnail: metadata.thumbnail, imageUrls: metadata.imageUrls }
  }
  const metadata = urlMetadataSchema.parse(artifact.metadata)
  return { ...common, requestedUrl: artifact.requestedUrl, finalUrl: artifact.finalUrl, mediaType: metadata.mediaType, description: metadata.description, siteName: metadata.siteName, thumbnailUrl: metadata.thumbnailUrl, imageUrls: metadata.imageUrls }
}

export const artifactEnvelope = (manifest: Readonly<Record<string, unknown>>, originalBytes: Uint8Array): Uint8Array => {
  const encoded = new TextEncoder().encode(JSON.stringify(manifest))
  if (encoded.byteLength > 4 * 1024 * 1024) throw new RangeError('Processed source metadata exceeds 4 MiB')
  const envelope = new Uint8Array(4 + encoded.byteLength + originalBytes.byteLength)
  new DataView(envelope.buffer).setUint32(0, encoded.byteLength)
  envelope.set(encoded, 4)
  envelope.set(originalBytes, 4 + encoded.byteLength)
  if (envelope.byteLength > 20 * 1024 * 1024) throw new RangeError('Processed source package exceeds 20 MiB')
  return envelope
}

export interface EnvelopeUpload {
  readonly requester: CompanionRequester
  readonly importId: string
  readonly operationKey: string
  readonly kind: 'url' | 'video' | 'pdf' | 'image'
  readonly envelope: Uint8Array
  readonly digest: string
  readonly offsetReached?: (offset: number) => Promise<void>
}

export type AcceptedReceipt = z.infer<typeof acceptedReceiptSchema>

export async function uploadEnvelope(upload: EnvelopeUpload): Promise<AcceptedReceipt> {
  const started = await upload.requester.request({ method: 'PUT', path: `/api/v1/companion/artifact-imports/${upload.importId}`, body: { operationKey: upload.operationKey, kind: upload.kind, totalBytes: upload.envelope.byteLength, sha256: upload.digest } })
  if (started.status < 200 || started.status >= 300) throw new Error(`Desktop returned status ${started.status}`)
  let nextOffset = stagingReceiptSchema.parse(started.body).nextOffset
  if (nextOffset > upload.envelope.byteLength) throw new Error('Desktop returned an invalid processed-source offset')
  await upload.offsetReached?.(nextOffset)
  while (nextOffset < upload.envelope.byteLength) {
    const chunkEnd = Math.min(nextOffset + 24 * 1024, upload.envelope.byteLength)
    const response = await upload.requester.request({ method: 'POST', path: `/api/v1/companion/artifact-imports/${upload.importId}/chunks`, body: { offset: nextOffset, bytes: base64Url(upload.envelope.subarray(nextOffset, chunkEnd)) } }, 5 * 60 * 1000)
    if (response.status < 200 || response.status >= 300) throw new Error(`Desktop returned status ${response.status}`)
    const receipt = chunkReceiptSchema.parse(response.body)
    if (receipt.state === 'accepted') {
      if (chunkEnd !== upload.envelope.byteLength) throw new Error('Desktop accepted an incomplete processed source')
      return receipt
    }
    if (receipt.nextOffset !== chunkEnd) throw new Error('Desktop returned an invalid processed-source offset')
    nextOffset = receipt.nextOffset
    await upload.offsetReached?.(nextOffset)
  }
  throw new Error('Desktop did not return a processed-source receipt')
}

async function prepareArtifactUpload(database: SQLiteDatabase, sourceId: string, mailboxId: string, digest: string): Promise<string> {
  const transfer = await database.getFirstAsync<{ transfer_id: string | null; transfer_sha256: string | null; destination_mailbox_id: string | null }>('SELECT transfer_id,transfer_sha256,destination_mailbox_id FROM local_source_artifacts WHERE source_id=?', sourceId)
  const importId = transfer?.transfer_id && transfer.transfer_sha256 === digest && transfer.destination_mailbox_id === mailboxId ? transfer.transfer_id : Crypto.randomUUID()
  await database.runAsync("UPDATE local_source_artifacts SET destination_mailbox_id=?,state='ready',transfer_id=?,transfer_sha256=?,transfer_next_offset=0 WHERE source_id=?", mailboxId, importId, digest, sourceId)
  return importId
}

export async function sendLocalSourceArtifact(requester: CompanionRequester, sourceId: string, mailboxId: string): Promise<{ readonly sourceId: string; readonly outcome: 'accepted' | 'duplicate' }> {
  const artifact = await localSourceArtifact(sourceId)
  if (!artifact) throw new Error('Processed source is unavailable')
  const envelope = artifactEnvelope(artifactManifest(artifact), artifact.originalBytes)
  const digest = await sha256(envelope)
  const database = await openEncryptedDatabase()
  try {
    const importId = await prepareArtifactUpload(database, sourceId, mailboxId, digest)
    const offsetReached = async (offset: number) => { await database.runAsync('UPDATE local_source_artifacts SET transfer_next_offset=? WHERE source_id=?', offset, sourceId) }
    const receipt = await uploadEnvelope({ requester, importId, operationKey: artifact.operationKey, kind: artifact.kind, envelope, digest, offsetReached })
    await withDatabaseTransaction(async transaction => {
      await rebindLearningIdentity(transaction, { sourceId, mailboxId: null }, { sourceId: receipt.sourceId, mailboxId })
      await transaction.runAsync('UPDATE local_source_artifacts SET desktop_source_id=?,receipt_json=?,transfer_id=NULL,transfer_sha256=NULL,transfer_next_offset=NULL WHERE source_id=?', receipt.sourceId, JSON.stringify(receipt), sourceId)
    })
    return { sourceId: receipt.sourceId, outcome: receipt.outcome }
  } catch (error) {
    await database.runAsync("UPDATE local_source_artifacts SET state='needs_attention' WHERE source_id=?", sourceId)
    throw error
  }
}
