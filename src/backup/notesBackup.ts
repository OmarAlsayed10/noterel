import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { appDisplayName } from '../edition'
import { backupAdditionalData as additionalData, backupMediaType, encryptedBackupSchema as encryptedSchema, plaintextBackupSchema as plaintextSchema } from './notesBackupFormat'
import { phoneNotesSnapshot, restorePhoneNotesSnapshot } from './notesBackupData'

export async function encryptedPhoneNotes(recoveryKey?: string): Promise<{ contents: string; recoveryKey: string; count: number }> {
  const plaintext = await phoneNotesSnapshot()
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(plaintext))
  if (plaintextBytes.byteLength > 10 * 1024 * 1024) throw new RangeError('This backup exceeds the 10 MiB portable backup limit')
  const key = recoveryKey ? await AESEncryptionKey.import(recoveryKey, 'base64') : await AESEncryptionKey.generate()
  const sealed = await aesEncryptAsync(plaintextBytes, key, { additionalData })
  const backup = encryptedSchema.parse({ schemaVersion: 1, algorithm: 'AES-256-GCM', ciphertext: await sealed.combined('base64') })
  return { contents: JSON.stringify(backup), recoveryKey: await key.encoded('base64'), count: plaintext.captures.length }
}

export async function restoreEncryptedPhoneNotes(contents: string, recoveryKey: string): Promise<number> {
  const encrypted = encryptedSchema.parse(JSON.parse(contents))
  const key = await AESEncryptionKey.import(recoveryKey.trim(), 'base64')
  const plaintextBytes = await aesDecryptAsync(AESSealedData.fromCombined(encrypted.ciphertext), key, { additionalData })
  const plaintext = plaintextSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintextBytes)))
  return restorePhoneNotesSnapshot(plaintext)
}

export async function exportPhoneNotes(): Promise<{ recoveryKey: string; count: number }> {
  const backup = await encryptedPhoneNotes()
  if (!FileSystem.cacheDirectory) throw new Error('Backup storage is unavailable')
  const path = `${FileSystem.cacheDirectory}kestrel-mobile-notes-${Date.now()}.kestrel`
  await FileSystem.writeAsStringAsync(path, backup.contents, { encoding: FileSystem.EncodingType.UTF8 })
  if (!await Sharing.isAvailableAsync()) throw new Error('Android sharing is unavailable')
  await Sharing.shareAsync(path, { mimeType: backupMediaType, dialogTitle: `Save encrypted ${appDisplayName} notes backup` })
  return { recoveryKey: backup.recoveryKey, count: backup.count }
}

export async function shareRecoveryKey(recoveryKey: string): Promise<void> {
  if (!FileSystem.cacheDirectory) throw new Error('Recovery-key storage is unavailable')
  const path = `${FileSystem.cacheDirectory}kestrel-recovery-key-${Date.now()}.txt`
  try {
    await FileSystem.writeAsStringAsync(path, recoveryKey, { encoding: FileSystem.EncodingType.UTF8 })
    if (!await Sharing.isAvailableAsync()) throw new Error('Android sharing is unavailable')
    await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: `Save ${appDisplayName} recovery key` })
  } finally {
    await FileSystem.deleteAsync(path, { idempotent: true })
  }
}

export async function importPhoneNotes(recoveryKey: string): Promise<number | null> {
  const selected = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'application/octet-stream', backupMediaType], copyToCacheDirectory: true, multiple: false })
  if (selected.canceled) return null
  const asset = selected.assets[0]
  if (!asset || asset.size && asset.size > 15 * 1024 * 1024) throw new RangeError('Backup file is too large')
  return restoreEncryptedPhoneNotes(await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 }), recoveryKey)
}
