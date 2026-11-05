import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { z } from 'zod'
import { phoneOnlyCaptures } from '../capture/outbox'
import type { MobileResponse } from '../companion/protocol'
import { encryptedPhoneNotes, restoreEncryptedPhoneNotes } from './notesBackup'
import { phoneNotesFingerprint } from './notesBackupData'
import { base64Url, hexadecimal } from '../bytes'

const enabledKey = 'kestrel.desktop-backup-enabled.v1'
const identityKey = 'kestrel.desktop-backup-id.v1'
const recoveryKeyName = 'kestrel.desktop-backup-recovery-key.v1'
const fingerprintKey = 'kestrel.desktop-backup-fingerprint.v1'
const encoder = new TextEncoder()

interface CompanionRequester {
  readonly mailboxId: string
  readonly request: (input: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; body: unknown }) => Promise<MobileResponse>
}

const backupListSchema = z.object({ backups: z.array(z.object({ backupId: z.string().uuid(), displayName: z.string(), noteCount: z.number().int(), updatedAt: z.string() })) })
const backupPageSchema = z.object({ backupId: z.string().uuid(), totalBytes: z.number().int().min(1).max(15 * 1024 * 1024), offset: z.number().int().nonnegative(), nextOffset: z.number().int().positive().nullable(), bytes: z.string().min(1).max(32_768).regex(/^[A-Za-z0-9_-]+$/) })

const decodeBase64Url = (value: string): Uint8Array => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), character => character.charCodeAt(0))

async function backupIdentity(): Promise<string> {
  const stored = await SecureStore.getItemAsync(identityKey)
  if (stored) return stored
  const created = Crypto.randomUUID()
  await SecureStore.setItemAsync(identityKey, created)
  return created
}

export async function automaticBackupSettings(): Promise<{ enabled: boolean }> {
  return { enabled: await SecureStore.getItemAsync(enabledKey) === 'true' }
}

export async function enableAutomaticBackup(): Promise<string> {
  const encrypted = await encryptedPhoneNotes()
  await SecureStore.setItemAsync(recoveryKeyName, encrypted.recoveryKey)
  await SecureStore.setItemAsync(enabledKey, 'true')
  return encrypted.recoveryKey
}

export async function disableAutomaticBackup(): Promise<void> {
  await SecureStore.setItemAsync(enabledKey, 'false')
}

export async function syncAutomaticBackup(requester: CompanionRequester, displayName: string): Promise<number | null> {
  if (await SecureStore.getItemAsync(enabledKey) !== 'true') return null
  const recoveryKey = await SecureStore.getItemAsync(recoveryKeyName)
  if (!recoveryKey) throw new Error('Desktop backup recovery key is missing')
  const captures = await phoneOnlyCaptures()
  const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, await phoneNotesFingerprint())
  const desktopFingerprintKey = `${fingerprintKey}.${requester.mailboxId}`
  if (fingerprint === await SecureStore.getItemAsync(desktopFingerprintKey)) return captures.length
  const backup = await encryptedPhoneNotes(recoveryKey)
  const bytes = encoder.encode(backup.contents)
  const sha256 = hexadecimal(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes))
  const backupId = await backupIdentity()
  const started = await requester.request({ method: 'PUT', path: `/api/v1/companion/backups/${backupId}`, body: { displayName, totalBytes: bytes.byteLength, sha256, noteCount: backup.count, updatedAt: new Date().toISOString() } })
  if (started.status !== 200) throw new Error(`Desktop returned status ${started.status}`)
  for (let offset = 0; offset < bytes.byteLength; offset += 24 * 1024) {
    const response = await requester.request({ method: 'POST', path: `/api/v1/companion/backups/${backupId}/chunks`, body: { offset, bytes: base64Url(bytes.subarray(offset, offset + 24 * 1024)) } })
    if (response.status !== 200) throw new Error(`Desktop returned status ${response.status}`)
  }
  await SecureStore.setItemAsync(desktopFingerprintKey, fingerprint)
  return backup.count
}

export async function availableDesktopBackups(requester: CompanionRequester) {
  const response = await requester.request({ method: 'GET', path: '/api/v1/companion/backups', body: null })
  if (response.status !== 200) throw new Error(`Desktop returned status ${response.status}`)
  return backupListSchema.parse(response.body).backups
}

export async function deleteDesktopBackup(requester: CompanionRequester, backupId: string): Promise<void> {
  const response = await requester.request({ method: 'DELETE', path: `/api/v1/companion/backups/${backupId}`, body: null })
  if (response.status < 200 || response.status >= 300) throw new Error(`Desktop returned status ${response.status}`)
}

export async function restoreDesktopBackup(requester: CompanionRequester, backupId: string, recoveryKey: string): Promise<number> {
  const pages: Uint8Array[] = []
  let offset = 0
  let totalBytes: number | null = null
  while (true) {
    const response = await requester.request({ method: 'GET', path: `/api/v1/companion/backups/${backupId}?offset=${offset}`, body: null })
    if (response.status !== 200) throw new Error(`Desktop returned status ${response.status}`)
    const page = backupPageSchema.parse(response.body)
    const bytes = decodeBase64Url(page.bytes)
    totalBytes ??= page.totalBytes
    const expectedNextOffset = offset + bytes.byteLength
    if (page.backupId !== backupId || page.totalBytes !== totalBytes || page.offset !== offset || bytes.byteLength > 24 * 1024 || page.nextOffset !== (expectedNextOffset === totalBytes ? null : expectedNextOffset)) throw new Error('Desktop backup page is invalid')
    pages.push(bytes)
    if (page.nextOffset === null) break
    offset = page.nextOffset
  }
  const byteLength = pages.reduce((sum, page) => sum + page.byteLength, 0)
  const bytes = new Uint8Array(byteLength)
  let position = 0
  for (const page of pages) {
    bytes.set(page, position)
    position += page.byteLength
  }
  return restoreEncryptedPhoneNotes(new TextDecoder().decode(bytes), recoveryKey)
}
