import * as Crypto from 'expo-crypto'
import { z } from 'zod'
import { applicationMessageMaximumBytes, type MobileResponse } from '../companion/protocol'
import { currentDesktopCard } from '../library/library'

interface CompanionRequester {
  readonly mailboxId: string
  readonly request: (input: { method: 'PUT' | 'GET' | 'POST'; path: string; body: unknown }) => Promise<MobileResponse>
}

const replacementResponseSchema = z.object({
  sourceId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  outcome: z.enum(['updated', 'replacement_pending'])
}).passthrough()

const jobSchema = z.object({ state: z.string() }).passthrough()

interface DesktopNoteDraft {
  readonly sourceId: string
  readonly title: string
  readonly text: string
  readonly projectId: string | null
  readonly updatedAt: string
}

const desktopNoteRequest = (note: DesktopNoteDraft, idempotencyKey: string) => ({ method: 'PUT' as const, path: `/api/v1/notes/${note.sourceId}`, body: { title: note.title, text: note.text, projectId: note.projectId, idempotencyKey, expectedUpdatedAt: note.updatedAt } })

export function desktopNoteEditTooLarge(note: DesktopNoteDraft): boolean {
  const encoder = new TextEncoder()
  return encoder.encode(note.text).byteLength > 1024 * 1024 || encoder.encode(note.title).byteLength > 512
}

function noteRequestEnvelopeBytes(request: { method: 'PUT' | 'POST'; path: string; body: unknown }): number {
  const envelope = { version: 1, requestId: '00000000-0000-4000-8000-000000000000', issuedAtMs: Date.now(), ...request }
  return new TextEncoder().encode(JSON.stringify(envelope)).byteLength
}

const chunkProgressSchema = z.object({ nextOffset: z.number().int().nonnegative(), totalBytes: z.number().int().positive().max(1024 * 1024) }).strict()
const editIdForKey = (key: string) => `${key.slice(0, 8)}-${key.slice(8, 12)}-4${key.slice(13, 16)}-8${key.slice(17, 20)}-${key.slice(20, 32)}`
const encodeChunk = (bytes: Uint8Array) => btoa([...bytes].map(byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function desktopSaveBody(response: MobileResponse): unknown {
  if (response.status === 409 || response.status === 404) throw Object.assign(new Error('This note changed on Desktop. Your phone edit is preserved.'), { code: 'DESKTOP_REVISION_CONFLICT' })
  if (response.status < 200 || response.status >= 300) throw new Error(`Desktop returned status ${response.status}`)
  return response.body
}

type StagedNoteDraft = Omit<DesktopNoteDraft, 'sourceId' | 'updatedAt' | 'title'> & { readonly sourceId: string | null; readonly updatedAt: string | null; readonly title: string | null }

async function uploadDesktopNote(requester: CompanionRequester, note: StagedNoteDraft, idempotencyKey: string): Promise<MobileResponse> {
  const bytes = new TextEncoder().encode(note.text)
  const transferKey = /^[0-9a-f]{64}$/.test(idempotencyKey) ? idempotencyKey : await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, idempotencyKey)
  const path = `/api/v1/companion/note-edits/${editIdForKey(transferKey)}`
  const start = await requester.request({ method: 'PUT', path, body: { sourceId: note.sourceId, title: note.title, projectId: note.projectId, expectedUpdatedAt: note.updatedAt, idempotencyKey, totalBytes: bytes.byteLength, textSha256: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, note.text) } })
  const progress = chunkProgressSchema.parse(desktopSaveBody(start))
  if (progress.totalBytes !== bytes.byteLength || progress.nextOffset > bytes.byteLength) throw new Error('Desktop returned invalid note upload progress')
  let offset = progress.nextOffset
  while (offset < bytes.byteLength) {
    const chunk = bytes.subarray(offset, offset + 24 * 1024)
    const response = await requester.request({ method: 'POST', path: `${path}/chunks`, body: { offset, bytes: encodeChunk(chunk) } })
    const appended = chunkProgressSchema.parse(desktopSaveBody(response))
    if (appended.totalBytes !== bytes.byteLength || appended.nextOffset !== offset + chunk.byteLength) throw new Error('Desktop returned invalid note upload progress')
    offset = appended.nextOffset
  }
  return requester.request({ method: 'POST', path: `${path}/commit`, body: {} })
}

export function createDesktopNote(requester: CompanionRequester, note: { readonly title: string | null; readonly text: string; readonly idempotencyKey: string }): Promise<MobileResponse> {
  const request = { method: 'POST' as const, path: '/api/v1/sources', body: { kind: 'manual_note', text: note.text, ...(note.title ? { title: note.title } : {}), idempotencyKey: note.idempotencyKey } }
  return noteRequestEnvelopeBytes(request) <= applicationMessageMaximumBytes
    ? requester.request(request)
    : uploadDesktopNote(requester, { sourceId: null, title: note.title ?? '', text: note.text, projectId: null, updatedAt: null }, note.idempotencyKey)
}

async function awaitDesktopSave(requester: CompanionRequester, jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await requester.request({ method: 'GET', path: `/api/v1/jobs/${jobId}`, body: null })
    if (response.status < 200 || response.status >= 300) throw new Error(`Desktop returned status ${response.status}`)
    const job = jobSchema.parse(response.body)
    if (job.state === 'succeeded') return
    if (job.state === 'failed' || job.state === 'cancelled') throw Object.assign(new Error('Desktop could not finish saving this note. Your phone edit is preserved.'), { code: 'DESKTOP_SAVE_FAILED' })
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error('Desktop is still saving this note. Your phone edit is preserved and will sync again.')
}

export function isDesktopNoteConflict(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'DESKTOP_REVISION_CONFLICT' || error.code === 'DESKTOP_SAVE_FAILED' || error.code === 'DESKTOP_EDIT_TOO_LARGE')
}

export async function replaceDesktopNote(requester: CompanionRequester, note: DesktopNoteDraft & { readonly queuedAtMs: number }) {
  if (desktopNoteEditTooLarge(note)) throw Object.assign(new Error('This edit is too large to sync directly. Your draft is kept on this phone. Shorten it or keep a phone copy.'), { code: 'DESKTOP_EDIT_TOO_LARGE' })
  const idempotencyKey = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([note.sourceId, note.updatedAt, note.title, note.text, note.projectId, note.queuedAtMs]))
  const body = noteRequestEnvelopeBytes(desktopNoteRequest(note, idempotencyKey)) <= applicationMessageMaximumBytes
    ? desktopSaveBody(await requester.request(desktopNoteRequest(note, idempotencyKey)))
    : desktopSaveBody(await uploadDesktopNote(requester, note, idempotencyKey))
  const receipt = replacementResponseSchema.parse(body)
  if (receipt.outcome === 'replacement_pending' && !receipt.jobId) throw new Error('Desktop did not return the save job')
  if (receipt.jobId) await awaitDesktopSave(requester, receipt.jobId)
  const card = await currentDesktopCard(requester, receipt.sourceId)
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, note.text)
  if (card.textSha256 !== digest || card.projectId !== note.projectId || (note.title && card.title !== note.title)) throw Object.assign(new Error('The saved note changed again on Desktop. Your phone edit is preserved.'), { code: 'DESKTOP_REVISION_CONFLICT' })
  return { ...receipt, card }
}
