import Constants from 'expo-constants'
import { z } from 'zod'
import KestrelSourceProcessing from '../../modules/kestrel-source-processing'
import { requestNotificationPermission } from '../notifications'

const manifestSchema = z.object({
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u),
  edition: z.enum(['public', 'internal']),
  versionCode: z.number().int().positive(),
  versionName: z.string().max(64),
  apkUrl: z.url().max(2048).refine(value => value.startsWith('https://')),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  notes: z.string().max(4096).optional()
}).strict()

export type AvailableUpdate = z.infer<typeof manifestSchema>

export const installedVersionCode = (): number => Constants.expoConfig?.android?.versionCode ?? 0
export const installedVersionName = (): string => Constants.expoConfig?.version ?? '0'

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const url = Constants.expoConfig?.extra?.updateManifestUrl
  if (typeof url !== 'string') return null
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(response.status === 404 ? 'No update feed has been published yet' : `Update check failed (${response.status})`)
  const manifest = manifestSchema.parse(await response.json())
  if (manifest.packageName !== Constants.expoConfig?.android?.package || manifest.edition !== Constants.expoConfig?.extra?.edition) throw new Error('Update feed does not match this Kestrel edition')
  return manifest.versionCode > installedVersionCode() ? manifest : null
}

export const cancelUpdateNotifications = (): Promise<void> => KestrelSourceProcessing.cancelUpdateChecks()

export async function scheduleUpdateNotifications(): Promise<void> {
  const url = Constants.expoConfig?.extra?.updateManifestUrl
  const edition = Constants.expoConfig?.extra?.edition
  if (typeof url !== 'string' || edition !== 'public' && edition !== 'internal') return
  if (await requestNotificationPermission()) await KestrelSourceProcessing.scheduleUpdateChecks(url, edition)
}

export type UpdateDownloadState = Awaited<ReturnType<typeof KestrelSourceProcessing.appUpdateDownloadState>>

export const updateDownloadState = (): Promise<UpdateDownloadState> => KestrelSourceProcessing.appUpdateDownloadState()

export async function downloadUpdate(update: AvailableUpdate): Promise<void> {
  await KestrelSourceProcessing.enqueueAppUpdate(update.apkUrl, update.sha256, update.versionCode)
}

export const installUpdate = (path: string): Promise<void> => KestrelSourceProcessing.installPackage(path)
