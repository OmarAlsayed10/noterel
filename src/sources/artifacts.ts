import * as Crypto from 'expo-crypto'
import { File, Paths } from 'expo-file-system'
import { z } from 'zod'
import { desktopOnlyLinkMessage, loginWalled } from '../capture/readability'
import { openEncryptedDatabase } from '../storage/database'
import { extractFacebookPost, extractFacebookVideo, facebookPostUrl, facebookVideoUrl } from './facebook'
import { extractCueTranscript, extractTikTokItem, extractTikTokTranscript, tiktokUrl, tiktokVideoUrl, type ExtractedTikTokItem } from './tiktok'
import { extractWebpage, instagramPostUrl, xPostUrl } from './webpage'
import { extractYouTubeClientConfig, extractYouTubeTranscript, extractYouTubeVideoResponse, youtubeVideoId } from './youtube'
import { rebuildLocalRelationships } from './relationships'
import { sha256 } from '../bytes'

export interface LocalSourceArtifactSummary {
  readonly sourceId: string
  readonly kind: 'url' | 'video' | 'pdf'
  readonly title: string
  readonly text: string
  readonly finalUrl: string | null
  readonly metadata: Readonly<Record<string, unknown>>
  readonly state: 'ready' | 'needs_attention'
  readonly desktopSourceId: string | null
  readonly extractedAtMs: number
}

export interface LocalExtractionProgress {
  readonly sourceId: string
  readonly state: 'processing' | 'needs_attention'
  readonly percent: number
  readonly stage: string
  readonly failureMessage: string | null
}

export interface LocalSourceArtifact {
  readonly sourceId: string
  readonly operationKey: string
  readonly kind: 'url' | 'video' | 'pdf'
  readonly title: string
  readonly text: string
  readonly requestedUrl: string | null
  readonly finalUrl: string | null
  readonly originalSha256: string
  readonly originalBytes: Uint8Array
  readonly textSha256: string
  readonly metadata: Readonly<Record<string, unknown>>
  readonly extractor: string
  readonly extractorVersion: string
  readonly extractedAtMs: number
}

const maximumExtractedTextBytes = 2 * 1024 * 1024
const activeExtractions = new Set<string>()
const normalizedCoordinate = z.number().finite().min(0).max(1)
const recognizedPdfSchema = z.object({
  engine: z.string().min(1).max(64),
  engineVersion: z.string().min(1).max(64),
  language: z.string().min(1).max(32),
  pages: z.array(z.object({
    pageNumber: z.number().int().min(1).max(100),
    text: z.string().max(maximumExtractedTextBytes),
    words: z.array(z.object({ text: z.string().min(1).max(256), left: normalizedCoordinate, top: normalizedCoordinate, width: normalizedCoordinate, height: normalizedCoordinate, confidence: normalizedCoordinate.nullable() }).strict()).max(4096)
  }).strict()).min(1).max(100)
}).strict()

const normalizedPageText = (text: string): string => text.replace(/\0/gu, '').replace(/\r/gu, '\n').split('\n').map(line => line.replace(/\t/gu, ' ').replace(/ {2,}/gu, ' ').trim()).filter(Boolean).join('\n')

const boundedText = (text: string): string => {
  const encoded = new TextEncoder().encode(text)
  if (encoded.byteLength > maximumExtractedTextBytes) throw new RangeError('Extracted source text exceeds 2 MiB')
  return text
}

const extractionKind = (requestedUrl: string): LocalSourceArtifact['kind'] => {
  if (tiktokUrl(requestedUrl)) return tiktokVideoUrl(requestedUrl) ? 'video' : 'url'
  return youtubeVideoId(requestedUrl) !== null || facebookVideoUrl(requestedUrl) ? 'video' : 'url'
}

async function queueLocalExtraction(sourceId: string, kind: LocalSourceArtifact['kind'], requestedUrl: string | null): Promise<void> {
  const database = await openEncryptedDatabase()
  await database.runAsync(`INSERT INTO local_source_artifacts(source_id,operation_key,kind,processing_authority,state,requested_url,final_url,original_sha256,original_bytes,metadata_json,text_content,text_sha256,extractor,extractor_version,extracted_at_ms,progress_percent,progress_stage,failure_message)
    VALUES(?,?,?,'mobile','processing',?,NULL,'',x'','{}','','','','',?,0,'Waiting to process',NULL) ON CONFLICT(source_id) DO UPDATE SET state='processing',progress_percent=0,progress_stage='Waiting to process',failure_message=NULL WHERE local_source_artifacts.text_sha256=''`, sourceId, Crypto.randomUUID(), kind, requestedUrl, Date.now())
}

export async function queueLocalWebpageProcessing(sourceId: string, requestedUrl: string): Promise<void> {
  if (facebookPostUrl(requestedUrl)) {
    const database = await openEncryptedDatabase()
    const legacyPost = await database.getFirstAsync<{ source_id: string }>("SELECT source_id FROM local_source_artifacts WHERE source_id=? AND kind='url' AND state='ready' AND desktop_source_id IS NULL AND destination_mailbox_id IS NULL AND text_sha256<>'' AND json_extract(metadata_json,'$.userEditedAtMs') IS NULL AND json_extract(metadata_json,'$.socialContentVersion') IS NULL", sourceId)
    if (legacyPost) {
      await refreshSavedSocialPost(sourceId)
      return
    }
  }
  await queueLocalExtraction(sourceId, extractionKind(requestedUrl), requestedUrl)
}
export const queueLocalPdfProcessing = (sourceId: string): Promise<void> => queueLocalExtraction(sourceId, 'pdf', null)

async function updateExtractionProgress(sourceId: string, percent: number, stage: string): Promise<void> {
  const database = await openEncryptedDatabase()
  await database.runAsync("UPDATE local_source_artifacts SET progress_percent=?,progress_stage=?,failure_message=NULL WHERE source_id=? AND state='processing'", percent, stage, sourceId)
}

async function claimLocalExtraction(sourceId: string, kind: LocalSourceArtifact['kind'], requestedUrl: string | null): Promise<string> {
  if (activeExtractions.has(sourceId)) throw new Error('This source is already being processed')
  activeExtractions.add(sourceId)
  const database = await openEncryptedDatabase()
  try {
    const pending = await database.getFirstAsync<{ operation_key: string }>("SELECT operation_key FROM local_source_artifacts WHERE source_id=? AND state IN ('processing','needs_attention') AND text_sha256=''", sourceId)
    const operationKey = pending?.operation_key ?? Crypto.randomUUID()
    await database.runAsync(`INSERT INTO local_source_artifacts(source_id,operation_key,kind,processing_authority,state,requested_url,final_url,original_sha256,original_bytes,metadata_json,text_content,text_sha256,extractor,extractor_version,extracted_at_ms)
      VALUES(?,?,?,'mobile','processing',?,NULL,'',x'','{}','','','','',?) ON CONFLICT(source_id) DO UPDATE SET operation_key=EXCLUDED.operation_key,kind=EXCLUDED.kind,processing_authority='mobile',state='processing',requested_url=EXCLUDED.requested_url,final_url=NULL,original_sha256='',original_bytes=x'',metadata_json='{}',text_content='',text_sha256='',extractor='',extractor_version='',extracted_at_ms=EXCLUDED.extracted_at_ms,destination_mailbox_id=NULL,desktop_source_id=NULL,receipt_json=NULL,transfer_id=NULL,transfer_sha256=NULL,transfer_next_offset=NULL,progress_percent=5,progress_stage='Checking source',failure_message=NULL`, sourceId, operationKey, kind, requestedUrl, Date.now())
    return operationKey
  } catch (error) {
    activeExtractions.delete(sourceId)
    throw error
  }
}

async function failedLocalExtraction(sourceId: string, error: unknown): Promise<void> {
  const database = await openEncryptedDatabase()
  try {
    const failureMessage = (error instanceof Error ? error.message : 'Source processing failed').slice(0, 512)
    await database.runAsync("UPDATE local_source_artifacts SET state='needs_attention',progress_stage='Processing failed',failure_message=? WHERE source_id=? AND text_sha256=''", failureMessage, sourceId)
  } finally {
    activeExtractions.delete(sourceId)
  }
}

const completedLocalExtraction = (sourceId: string): void => { activeExtractions.delete(sourceId) }

async function saveLocalSourceArtifact(artifact: LocalSourceArtifact): Promise<void> {
  const database = await openEncryptedDatabase()
  const metadataJson = JSON.stringify(artifact.metadata)
  const metadataBytes = new TextEncoder().encode(metadataJson).byteLength
  if (metadataBytes > 4 * 1024 * 1024) throw new RangeError('Processed source metadata exceeds 4 MiB')
  const usage = await database.getFirstAsync<{ bytes: number }>('SELECT coalesce(sum(length(original_bytes)+length(CAST(metadata_json AS BLOB))+length(CAST(text_content AS BLOB))),0) AS bytes FROM local_source_artifacts WHERE source_id<>?', artifact.sourceId)
  if (!usage || usage.bytes + artifact.originalBytes.byteLength + metadataBytes + new TextEncoder().encode(artifact.text).byteLength > 64 * 1024 * 1024) throw new RangeError('Processed source storage is full')
  await database.runAsync(`INSERT INTO local_source_artifacts(source_id,operation_key,kind,processing_authority,state,requested_url,final_url,original_sha256,original_bytes,metadata_json,text_content,text_sha256,extractor,extractor_version,extracted_at_ms,progress_percent,progress_stage,failure_message)
    VALUES(?,?,?,'mobile','ready',?,?,?,?,?,?,?,?,?,?,100,'Ready',NULL) ON CONFLICT(source_id) DO UPDATE SET operation_key=EXCLUDED.operation_key,kind=EXCLUDED.kind,processing_authority='mobile',state='ready',requested_url=EXCLUDED.requested_url,final_url=EXCLUDED.final_url,original_sha256=EXCLUDED.original_sha256,original_bytes=EXCLUDED.original_bytes,metadata_json=EXCLUDED.metadata_json,text_content=EXCLUDED.text_content,text_sha256=EXCLUDED.text_sha256,extractor=EXCLUDED.extractor,extractor_version=EXCLUDED.extractor_version,extracted_at_ms=EXCLUDED.extracted_at_ms,destination_mailbox_id=NULL,desktop_source_id=NULL,receipt_json=NULL,progress_percent=100,progress_stage='Ready',failure_message=NULL`, artifact.sourceId, artifact.operationKey, artifact.kind, artifact.requestedUrl, artifact.finalUrl, artifact.originalSha256, artifact.originalBytes, metadataJson, boundedText(artifact.text), artifact.textSha256, artifact.extractor, artifact.extractorVersion, artifact.extractedAtMs)
  await rebuildLocalRelationships(artifact.sourceId, artifact.text)
}

export async function localSourceArtifact(sourceId: string): Promise<LocalSourceArtifact | null> {
  const database = await openEncryptedDatabase()
  const row = await database.getFirstAsync<{ source_id: string; operation_key: string; kind: LocalSourceArtifact['kind']; requested_url: string | null; final_url: string | null; original_sha256: string; original_bytes: Uint8Array; metadata_json: string; text_content: string; text_sha256: string; extractor: string; extractor_version: string; extracted_at_ms: number }>('SELECT source_id,operation_key,kind,requested_url,final_url,original_sha256,original_bytes,metadata_json,text_content,text_sha256,extractor,extractor_version,extracted_at_ms FROM local_source_artifacts WHERE source_id=? AND state IN (\'ready\',\'needs_attention\') AND text_sha256<>\'\'', sourceId)
  if (!row) return null
  const metadata = JSON.parse(row.metadata_json) as Readonly<Record<string, unknown>>
  const title = typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title : 'Untitled source'
  return { sourceId: row.source_id, operationKey: row.operation_key, kind: row.kind, title, text: row.text_content, requestedUrl: row.requested_url, finalUrl: row.final_url, originalSha256: row.original_sha256, originalBytes: row.original_bytes, textSha256: row.text_sha256, metadata, extractor: row.extractor, extractorVersion: row.extractor_version, extractedAtMs: row.extracted_at_ms }
}

export async function updateLocalSourceArtifact(sourceId: string, title: string, text: string): Promise<void> {
  const normalizedTitle = title.trim() || 'Untitled source'
  if (new TextEncoder().encode(normalizedTitle).byteLength > 512) throw new RangeError('Source title exceeds 512 bytes')
  if (!text.trim()) throw new RangeError('Source text is required')
  const bounded = boundedText(text)
  const database = await openEncryptedDatabase()
  const stored = await database.getFirstAsync<{ metadata_json: string; original_bytes: Uint8Array }>("SELECT metadata_json,original_bytes FROM local_source_artifacts WHERE source_id=? AND state IN ('ready','needs_attention') AND text_sha256<>''", sourceId)
  if (!stored) throw new Error('Processed source is unavailable')
  const metadataJson = JSON.stringify({ ...JSON.parse(stored.metadata_json) as Readonly<Record<string, unknown>>, title: normalizedTitle, userEditedAtMs: Date.now() })
  const usage = await database.getFirstAsync<{ bytes: number }>('SELECT coalesce(sum(length(original_bytes)+length(CAST(metadata_json AS BLOB))+length(CAST(text_content AS BLOB))),0) AS bytes FROM local_source_artifacts WHERE source_id<>?', sourceId)
  const editedBytes = stored.original_bytes.byteLength + new TextEncoder().encode(metadataJson).byteLength + new TextEncoder().encode(bounded).byteLength
  if (!usage || usage.bytes + editedBytes > 64 * 1024 * 1024) throw new RangeError('Processed source storage is full')
  const textSha256 = await sha256(new TextEncoder().encode(bounded))
  const updated = await database.runAsync("UPDATE local_source_artifacts SET metadata_json=?,text_content=?,text_sha256=?,state='ready',progress_percent=100,progress_stage='Ready',failure_message=NULL WHERE source_id=?", metadataJson, bounded, textSha256, sourceId)
  if (updated.changes !== 1) throw new Error('Processed source is unavailable')
  await rebuildLocalRelationships(sourceId, bounded)
}

export async function localSourceArtifactSummaries(sourceIds: readonly string[]): Promise<ReadonlyMap<string, LocalSourceArtifactSummary>> {
  if (sourceIds.length === 0) return new Map()
  const database = await openEncryptedDatabase()
  const placeholders = sourceIds.map(() => '?').join(',')
  const rows = await database.getAllAsync<{ source_id: string; kind: LocalSourceArtifactSummary['kind']; final_url: string | null; metadata_json: string; text_content: string; state: LocalSourceArtifactSummary['state']; desktop_source_id: string | null; extracted_at_ms: number }>(`SELECT source_id,kind,final_url,metadata_json,text_content,state,desktop_source_id,extracted_at_ms FROM local_source_artifacts WHERE state IN ('ready','needs_attention') AND text_sha256<>'' AND source_id IN (${placeholders})`, ...sourceIds)
  return new Map(rows.map(row => {
    const metadata = JSON.parse(row.metadata_json) as Readonly<Record<string, unknown>>
    const title = typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title : 'Untitled source'
    return [row.source_id, { sourceId: row.source_id, kind: row.kind, title, text: row.text_content, finalUrl: row.final_url, metadata, state: row.state, desktopSourceId: row.desktop_source_id, extractedAtMs: row.extracted_at_ms }] as const
  }))
}

export async function localExtractionProgress(sourceIds: readonly string[]): Promise<ReadonlyMap<string, LocalExtractionProgress>> {
  if (sourceIds.length === 0) return new Map()
  const database = await openEncryptedDatabase()
  const placeholders = sourceIds.map(() => '?').join(',')
  const rows = await database.getAllAsync<{ source_id: string; state: LocalExtractionProgress['state']; progress_percent: number; progress_stage: string; failure_message: string | null }>(`SELECT source_id,state,progress_percent,progress_stage,failure_message FROM local_source_artifacts WHERE text_sha256='' AND state IN ('processing','needs_attention') AND source_id IN (${placeholders})`, ...sourceIds)
  return new Map(rows.map(row => [row.source_id, { sourceId: row.source_id, state: row.state, percent: Math.max(0, Math.min(100, row.progress_percent)), stage: row.progress_stage, failureMessage: row.failure_message }] as const))
}

interface LocalPdfExtraction {
  readonly sourceId: string
  readonly operationKey: string
  readonly filename: string
  readonly uri: string
  readonly originalBytes: Uint8Array
}

async function recognizedPdfArtifact(extraction: LocalPdfExtraction): Promise<LocalSourceArtifact> {
  const native = (await import('../../modules/kestrel-source-processing')).default
  await updateExtractionProgress(extraction.sourceId, 20, 'Reading PDF pages')
  const recognition = recognizedPdfSchema.parse(await native.recognizePdf(extraction.uri))
  await updateExtractionProgress(extraction.sourceId, 85, 'Preparing searchable text')
  const text = boundedText(recognition.pages.map(page => normalizedPageText(page.text)).filter(Boolean).join('\n\n'))
  if (!text) throw new RangeError('Recognition produced no readable text')
  const artifact: LocalSourceArtifact = { sourceId: extraction.sourceId, operationKey: extraction.operationKey, kind: 'pdf', title: extraction.filename, text, requestedUrl: null, finalUrl: null, originalSha256: await sha256(extraction.originalBytes), originalBytes: extraction.originalBytes, textSha256: await sha256(new TextEncoder().encode(text)), metadata: { title: extraction.filename, filename: extraction.filename, mediaType: 'application/pdf', recognition }, extractor: recognition.engine, extractorVersion: recognition.engineVersion, extractedAtMs: Date.now() }
  await saveLocalSourceArtifact(artifact)
  return artifact
}

export async function retryLocalPdfProcessing(sourceId: string): Promise<LocalSourceArtifact> {
  const database = await openEncryptedDatabase()
  let stored: { filename: string; bytes: Uint8Array } | null
  stored = await database.getFirstAsync<{ filename: string; bytes: Uint8Array }>('SELECT filename,bytes FROM pending_pdf_imports WHERE id=?', sourceId)
  if (!stored) throw new Error('Pending PDF is unavailable')
  const temporary = new File(Paths.cache, `${sourceId}.pdf`)
  const operationKey = await claimLocalExtraction(sourceId, 'pdf', null)
  try {
    temporary.create({ overwrite: true })
    temporary.write(stored.bytes)
    const artifact = await recognizedPdfArtifact({ sourceId, operationKey, filename: stored.filename, uri: temporary.uri, originalBytes: stored.bytes })
    completedLocalExtraction(sourceId)
    return artifact
  } catch (error) {
    await failedLocalExtraction(sourceId, error)
    throw error
  } finally {
    if (temporary.exists) temporary.delete()
  }
}

interface LocalWebExtraction {
  readonly sourceId: string
  readonly operationKey: string
  readonly requestedUrl: string
  readonly preferredTitle: string | null
}

async function youtubeArtifact(extraction: LocalWebExtraction, html: string): Promise<LocalSourceArtifact> {
  const native = (await import('../../modules/kestrel-source-processing')).default
  await updateExtractionProgress(extraction.sourceId, 45, 'Reading video details')
  const videoId = youtubeVideoId(extraction.requestedUrl)!
  const player = await native.fetchYouTubePlayer(videoId, extractYouTubeClientConfig(html).apiKey)
  const video = extractYouTubeVideoResponse(extraction.requestedUrl, player)
  if (!video.captionUrl) throw new RangeError('This YouTube video has no accessible captions. Import the video file for local transcription.')
  await updateExtractionProgress(extraction.sourceId, 60, 'Downloading captions')
  const captionUrl = new URL(video.captionUrl)
  captionUrl.searchParams.set('fmt', 'json3')
  const transcript = extractYouTubeTranscript(await native.fetchYouTubeCaptions(captionUrl.toString()))
  const text = boundedText(transcript.text)
  await updateExtractionProgress(extraction.sourceId, 80, 'Saving video details')
  const thumbnail = await native.fetchYouTubeThumbnail(video.thumbnailUrl)
  const originalBytes = new TextEncoder().encode(html)
  const title = extraction.preferredTitle || video.title
  return { sourceId: extraction.sourceId, operationKey: extraction.operationKey, kind: 'video', title, text, requestedUrl: extraction.requestedUrl, finalUrl: video.canonicalUrl, originalSha256: await sha256(originalBytes), originalBytes, textSha256: await sha256(new TextEncoder().encode(text)), metadata: { ...video, title, segments: transcript.segments, captionsAvailable: true, thumbnail }, extractor: 'kestrel-mobile-youtube', extractorVersion: '2', extractedAtMs: Date.now() }
}

async function facebookPostArtifact(extraction: LocalWebExtraction, html: string, finalUrl: string): Promise<LocalSourceArtifact> {
  const post = extractFacebookPost(html, finalUrl)
  const originalBytes = new TextEncoder().encode(html)
  const text = boundedText(post.text)
  return { sourceId: extraction.sourceId, operationKey: extraction.operationKey, kind: 'url', title: extraction.preferredTitle || post.title, text, requestedUrl: extraction.requestedUrl, finalUrl: post.canonicalUrl, originalSha256: await sha256(originalBytes), originalBytes, textSha256: await sha256(new TextEncoder().encode(text)), metadata: { title: extraction.preferredTitle || post.title, description: null, siteName: 'Facebook', thumbnailUrl: post.imageUrls[0] ?? null, imageUrls: post.imageUrls, mediaType: 'text/html', provider: 'facebook', socialContentVersion: 1 }, extractor: 'kestrel-mobile-facebook-post', extractorVersion: '1', extractedAtMs: Date.now() }
}

async function facebookArtifact(extraction: LocalWebExtraction): Promise<LocalSourceArtifact> {
  const native = (await import('../../modules/kestrel-source-processing')).default
  await updateExtractionProgress(extraction.sourceId, 20, 'Downloading source')
  const fetched = await native.fetchFacebookVideo(extraction.requestedUrl)
  await updateExtractionProgress(extraction.sourceId, 40, 'Reading video details')
  const video = extractFacebookVideo(fetched.html, fetched.finalUrl)
  const transcript = video.captionUrl ? extractCueTranscript(await native.fetchFacebookCaptions(video.captionUrl), 'Facebook') : null
  if (!video.postText && !transcript) throw new RangeError('Facebook did not expose post text or captions. Share an audio file here for Whisper transcription, or use Add → Audio on Desktop.')
  const text = boundedText([video.postText, transcript?.text].filter((part, index, parts): part is string => Boolean(part?.trim()) && parts.indexOf(part) === index).join('\n\n'))
  await updateExtractionProgress(extraction.sourceId, 80, 'Saving video details')
  const originalBytes = new TextEncoder().encode(fetched.html)
  const title = extraction.preferredTitle || video.title
  const segments = transcript?.segments ?? []
  return { sourceId: extraction.sourceId, operationKey: extraction.operationKey, kind: 'video', title, text, requestedUrl: extraction.requestedUrl, finalUrl: video.canonicalUrl, originalSha256: await sha256(originalBytes), originalBytes, textSha256: await sha256(new TextEncoder().encode(text)), metadata: { title, provider: 'facebook', videoId: video.videoId, channel: video.owner ?? 'Facebook', durationMs: Math.max(1, segments[segments.length - 1]?.endMs ?? 1), captionLanguage: video.captionLanguage, captionSource: transcript ? 'facebook-auto' : null, segments, captionsAvailable: Boolean(transcript), imageUrls: video.imageUrls, socialContentVersion: 1 }, extractor: 'kestrel-mobile-facebook', extractorVersion: '2', extractedAtMs: Date.now() }
}

async function tiktokArtifact(extraction: LocalWebExtraction, html: string, video: ExtractedTikTokItem): Promise<LocalSourceArtifact> {
  const native = (await import('../../modules/kestrel-source-processing')).default
  if (!video.captionUrl) throw new RangeError('This TikTok video has no captions to read. Import the video file for local transcription.')
  await updateExtractionProgress(extraction.sourceId, 60, 'Downloading captions')
  const transcript = extractTikTokTranscript(await native.fetchTikTokCaptions(video.captionUrl))
  const text = boundedText(transcript.text)
  await updateExtractionProgress(extraction.sourceId, 80, 'Saving video details')
  const originalBytes = new TextEncoder().encode(html)
  const title = extraction.preferredTitle || video.title
  return { sourceId: extraction.sourceId, operationKey: extraction.operationKey, kind: 'video', title, text, requestedUrl: extraction.requestedUrl, finalUrl: video.canonicalUrl, originalSha256: await sha256(originalBytes), originalBytes, textSha256: await sha256(new TextEncoder().encode(text)), metadata: { title, provider: 'tiktok', videoId: video.videoId, channel: video.author, durationMs: video.durationMs, captionLanguage: video.captionLanguage, captionSource: video.captionSource, segments: transcript.segments, captionsAvailable: true }, extractor: 'kestrel-mobile-tiktok', extractorVersion: '1', extractedAtMs: Date.now() }
}

async function processLocalWebpage(sourceId: string, requestedUrl: string, preferredTitle: string | null, selectedCaptionLanguage?: string): Promise<LocalSourceArtifact> {
  const kind = extractionKind(requestedUrl)
  const videoSource = youtubeVideoId(requestedUrl) !== null
  const operationKey = await claimLocalExtraction(sourceId, kind, requestedUrl)
  try {
    const native = (await import('../../modules/kestrel-source-processing')).default
    const requestUrl = new URL(requestedUrl)
    if (facebookVideoUrl(requestedUrl)) {
      const artifact = await facebookArtifact({ sourceId, operationKey, requestedUrl, preferredTitle })
      await updateExtractionProgress(sourceId, 90, 'Encrypting extracted text')
      await saveLocalSourceArtifact(artifact)
      completedLocalExtraction(sourceId)
      return artifact
    }
    if (videoSource) requestUrl.searchParams.set('hl', 'en')
    await updateExtractionProgress(sourceId, 20, 'Downloading source')
    const fetched = await native.fetchPublicSource(requestUrl.toString())
    await updateExtractionProgress(sourceId, 40, 'Checking downloaded content')
    if (fetched.mediaType !== 'text/html' && fetched.mediaType !== 'text/plain') throw new RangeError('Webpage content type is not supported')
    const extraction = { sourceId, operationKey, requestedUrl, preferredTitle }
    const facebookPostFinalUrl = facebookPostUrl(fetched.finalUrl) ? fetched.finalUrl : facebookPostUrl(requestedUrl) ? requestedUrl : null
    if (facebookPostFinalUrl) {
      const artifact = await facebookPostArtifact(extraction, fetched.text, facebookPostFinalUrl)
      await updateExtractionProgress(sourceId, 90, 'Encrypting extracted text')
      await saveLocalSourceArtifact(artifact)
      completedLocalExtraction(sourceId)
      return artifact
    }
    const tiktokItem = fetched.mediaType === 'text/html' && tiktokUrl(fetched.finalUrl) ? extractTikTokItem(fetched.text, fetched.finalUrl, selectedCaptionLanguage) : null
    if (!tiktokItem && tiktokVideoUrl(fetched.finalUrl)) throw new RangeError(`TikTok did not send this video's details to your phone (${Math.round(new TextEncoder().encode(fetched.text).byteLength / 1024)} KB page, ${fetched.text.includes('__UNIVERSAL_DATA_FOR_REHYDRATION__') ? 'payload present but unreadable' : 'no payload'}). Open the video in TikTok and share it here again.`)
    if (tiktokItem && !tiktokItem.captionUrl && tiktokItem.captionLanguages.length > 1 && !selectedCaptionLanguage) throw new RangeError('Share this TikTok link again and choose a caption language before saving.')
    if (tiktokItem && !tiktokItem.captionUrl && selectedCaptionLanguage) throw new RangeError('The selected TikTok caption language is no longer available. Retry and choose another.')
    if (tiktokItem && !tiktokItem.captionUrl) throw new RangeError('TikTok did not expose captions. Share an audio file here for Whisper transcription, or use Add → Audio on Desktop.')
    const artifact = videoSource && fetched.mediaType === 'text/html' ? await youtubeArtifact(extraction, fetched.text) : tiktokItem ? await tiktokArtifact(extraction, fetched.text, tiktokItem) : await webpageArtifact(extraction, fetched)
    await updateExtractionProgress(sourceId, 90, 'Encrypting extracted text')
    await saveLocalSourceArtifact(artifact)
    completedLocalExtraction(sourceId)
    return artifact
  } catch (error) {
    await failedLocalExtraction(sourceId, error)
    throw error
  }
}

export const retryLocalWebpageProcessing = (sourceId: string, requestedUrl: string, preferredTitle: string | null, selectedCaptionLanguage?: string): Promise<LocalSourceArtifact> => processLocalWebpage(sourceId, requestedUrl, preferredTitle, selectedCaptionLanguage)

export async function processNextQueuedLocalExtraction(): Promise<boolean> {
  const database = await openEncryptedDatabase()
  let pending: { source_id: string; kind: LocalSourceArtifact['kind']; requested_url: string | null; preferred_title: string | null; caption_language: string | null } | null
  pending = await database.getFirstAsync<{ source_id: string; kind: LocalSourceArtifact['kind']; requested_url: string | null; preferred_title: string | null; caption_language: string | null }>(`SELECT artifact.source_id,artifact.kind,artifact.requested_url,json_extract(coalesce(note.payload_json,queued.payload_json),'$.title') AS preferred_title,json_extract(coalesce(note.payload_json,queued.payload_json),'$.captionLanguage') AS caption_language
    FROM local_source_artifacts artifact LEFT JOIN local_notes note ON note.id=artifact.source_id LEFT JOIN outbox_operations queued ON queued.id=artifact.source_id
    WHERE artifact.state='processing' AND artifact.text_sha256='' ORDER BY artifact.extracted_at_ms LIMIT 1`)
  if (!pending || activeExtractions.has(pending.source_id)) return false
  if (pending.kind === 'pdf') await retryLocalPdfProcessing(pending.source_id)
  else if (pending.requested_url) await processLocalWebpage(pending.source_id, pending.requested_url, pending.preferred_title, pending.caption_language ?? undefined)
  else await failedLocalExtraction(pending.source_id, new Error('Queued source URL is unavailable'))
  return true
}

async function webpageArtifact(extraction: LocalWebExtraction, fetched: { readonly finalUrl: string; readonly mediaType: 'text/html' | 'text/plain'; readonly text: string }): Promise<LocalSourceArtifact> {
  const originalBytes = new TextEncoder().encode(fetched.text)
  const extracted = fetched.mediaType === 'text/html' ? extractWebpage(fetched.text, fetched.finalUrl) : { title: null, description: null, siteName: new URL(fetched.finalUrl).hostname, thumbnailUrl: null, text: fetched.text }
  const text = boundedText(extracted.text)
  if (loginWalled(fetched.finalUrl, extracted.title)) throw new RangeError(desktopOnlyLinkMessage)
  const title = extracted.postProvider ? extracted.title ?? 'X post' : extraction.preferredTitle || extracted.title || new URL(fetched.finalUrl).hostname
  const extractor = extracted.postProvider === 'x' ? 'kestrel-mobile-x-post' : extracted.postProvider === 'instagram' ? 'kestrel-mobile-instagram-post' : 'kestrel-mobile-webpage'
  return { sourceId: extraction.sourceId, operationKey: extraction.operationKey, kind: 'url', title, text, requestedUrl: extraction.requestedUrl, finalUrl: fetched.finalUrl, originalSha256: await sha256(originalBytes), originalBytes, textSha256: await sha256(new TextEncoder().encode(text)), metadata: { title, description: extracted.description, siteName: extracted.siteName, thumbnailUrl: extracted.thumbnailUrl, mediaType: fetched.mediaType, ...(extracted.imageUrls ? { imageUrls: extracted.imageUrls } : {}), ...(extracted.postProvider ? { postProvider: extracted.postProvider, socialContentVersion: extracted.socialContentVersion } : {}) }, extractor, extractorVersion: extracted.postProvider ? '1' : '2', extractedAtMs: Date.now() }
}

async function refreshSavedSocialPost(sourceId: string): Promise<void> {
  const saved = await localSourceArtifact(sourceId)
  if (!saved?.finalUrl || saved.metadata.userEditedAtMs) throw new Error('This social post cannot be refreshed')
  const originalHtml = new TextDecoder('utf-8', { fatal: true }).decode(saved.originalBytes)
  let text = saved.text
  let metadata: Readonly<Record<string, unknown>>
  let extractor = saved.extractor
  let extractorVersion = saved.extractorVersion
  if (xPostUrl(saved.finalUrl) || instagramPostUrl(saved.finalUrl)) {
    const extracted = extractWebpage(originalHtml, saved.finalUrl)
    if (extracted.postProvider !== 'x' && extracted.postProvider !== 'instagram') throw new Error('Social post content is unavailable')
    text = extracted.text
    metadata = { ...saved.metadata, title: extracted.title ?? `${extracted.postProvider} post`, description: null, siteName: extracted.siteName, thumbnailUrl: extracted.thumbnailUrl, imageUrls: extracted.imageUrls ?? [], postProvider: extracted.postProvider, socialContentVersion: 1 }
    extractor = extracted.postProvider === 'x' ? 'kestrel-mobile-x-post' : 'kestrel-mobile-instagram-post'
    extractorVersion = '1'
  } else if (saved.kind === 'url' && (facebookPostUrl(saved.requestedUrl ?? saved.finalUrl) || facebookPostUrl(saved.finalUrl))) {
    const post = extractFacebookPost(originalHtml, facebookPostUrl(saved.finalUrl) ? saved.finalUrl : saved.requestedUrl!)
    text = post.text
    metadata = { ...saved.metadata, title: post.title, imageUrls: post.imageUrls, thumbnailUrl: post.imageUrls[0] ?? null, socialContentVersion: 1 }
    extractor = 'kestrel-mobile-facebook-post'
    extractorVersion = '1'
  } else if (saved.metadata.provider === 'facebook') {
    const video = extractFacebookVideo(originalHtml, saved.finalUrl)
    text = saved.text
    metadata = { ...saved.metadata, imageUrls: video.imageUrls, socialContentVersion: 1 }
    extractor = 'kestrel-mobile-facebook'
    extractorVersion = '2'
  } else throw new Error('Social post provider is unavailable')
  const bounded = boundedText(text)
  const metadataJson = JSON.stringify(metadata)
  if (new TextEncoder().encode(metadataJson).byteLength > 4 * 1024 * 1024) throw new RangeError('Processed source metadata exceeds 4 MiB')
  const database = await openEncryptedDatabase()
  const updated = await database.runAsync("UPDATE local_source_artifacts SET metadata_json=?,text_content=?,text_sha256=?,extractor=?,extractor_version=?,extracted_at_ms=? WHERE source_id=? AND state='ready' AND desktop_source_id IS NULL AND destination_mailbox_id IS NULL AND text_sha256<>'' AND json_extract(metadata_json,'$.userEditedAtMs') IS NULL AND json_extract(metadata_json,'$.socialContentVersion') IS NULL", metadataJson, bounded, await sha256(new TextEncoder().encode(bounded)), extractor, extractorVersion, saved.extractedAtMs, sourceId)
  if (updated.changes !== 1) throw new Error('Saved social post was changed or has already been sent')
  await rebuildLocalRelationships(sourceId, bounded)
}

const socialPostRefreshVersion = 1

async function savedSocialPostsNeedingRefresh(): Promise<readonly { readonly source_id: string }[]> {
  const database = await openEncryptedDatabase()
  return database.getAllAsync<{ source_id: string }>("SELECT source_id FROM local_source_artifacts WHERE state='ready' AND processing_authority='mobile' AND desktop_source_id IS NULL AND destination_mailbox_id IS NULL AND final_url IS NOT NULL AND text_sha256<>'' AND json_extract(metadata_json,'$.socialContentVersion') IS NULL AND json_extract(metadata_json,'$.userEditedAtMs') IS NULL AND coalesce(json_extract(metadata_json,'$.socialRefreshAttemptVersion'),0)<? AND ((kind='url' AND (lower(final_url) LIKE 'https://%x.com/%' OR lower(final_url) LIKE 'https://%twitter.com/%' OR lower(final_url) LIKE 'https://%instagram.com/p/%' OR lower(final_url) LIKE 'https://%instagram.com/reel/%' OR lower(final_url) LIKE 'https://%instagram.com/tv/%')) OR ((kind='url' OR kind='video') AND json_extract(metadata_json,'$.provider')='facebook') OR (kind='url' AND lower(requested_url) LIKE 'https://%facebook.com/share/%')) ORDER BY extracted_at_ms LIMIT 500", socialPostRefreshVersion)
}

async function rememberFailedSocialPostRefresh(sourceId: string): Promise<void> {
  const database = await openEncryptedDatabase()
  await database.runAsync("UPDATE local_source_artifacts SET metadata_json=json_set(metadata_json,'$.socialRefreshAttemptVersion',?) WHERE source_id=? AND state='ready' AND processing_authority='mobile' AND desktop_source_id IS NULL AND destination_mailbox_id IS NULL AND text_sha256<>'' AND json_extract(metadata_json,'$.userEditedAtMs') IS NULL AND json_extract(metadata_json,'$.socialContentVersion') IS NULL", socialPostRefreshVersion, sourceId)
}

export async function refreshSavedSocialPosts(): Promise<{ readonly cleaned: number; readonly failed: number }> {
  const candidates = await savedSocialPostsNeedingRefresh()
  let cleaned = 0
  let failed = 0
  for (const candidate of candidates) {
    try {
      await refreshSavedSocialPost(candidate.source_id)
      cleaned += 1
    } catch {
      await rememberFailedSocialPostRefresh(candidate.source_id)
      failed += 1
    }
  }
  return { cleaned, failed }
}
