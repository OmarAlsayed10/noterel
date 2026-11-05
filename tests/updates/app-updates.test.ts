import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0', android: { package: 'com.kestrelbrain.mobile', versionCode: 2 }, extra: { edition: 'public', updateManifestUrl: 'https://updates.example/latest.json' } } } }))
const updateBoundary = vi.hoisted(() => ({ scheduleUpdateChecks: vi.fn(), enqueueAppUpdate: vi.fn(), requestNotificationPermission: vi.fn() }))
vi.mock('../../modules/kestrel-source-processing', () => ({ default: { scheduleUpdateChecks: updateBoundary.scheduleUpdateChecks, enqueueAppUpdate: updateBoundary.enqueueAppUpdate } }))
vi.mock('../../src/notifications', () => ({ requestNotificationPermission: updateBoundary.requestNotificationPermission }))

import { checkForUpdate, downloadUpdate, scheduleUpdateNotifications } from '../../src/updates/appUpdates'

const manifest = { packageName: 'com.kestrelbrain.mobile', edition: 'public' as const, versionCode: 3, versionName: '0.2.0', apkUrl: 'https://updates.example/kestrel.apk', sha256: 'a'.repeat(64) }

describe('edition-bound update manifests', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('enables background update checks only with notification permission', async () => {
    updateBoundary.scheduleUpdateChecks.mockReset()
    updateBoundary.requestNotificationPermission.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await scheduleUpdateNotifications()
    expect(updateBoundary.scheduleUpdateChecks).not.toHaveBeenCalled()
    await scheduleUpdateNotifications()
    expect(updateBoundary.scheduleUpdateChecks).toHaveBeenCalledWith('https://updates.example/latest.json', 'public')
  })

  it('hands the APK download to Android instead of tying it to the open app', async () => {
    updateBoundary.enqueueAppUpdate.mockResolvedValueOnce(undefined)
    await downloadUpdate(manifest)
    expect(updateBoundary.enqueueAppUpdate).toHaveBeenCalledWith(manifest.apkUrl, manifest.sha256, manifest.versionCode)
  })

  it('accepts a newer manifest for the installed package and edition', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => manifest }))
    await expect(checkForUpdate()).resolves.toEqual(manifest)
  })

  it('rejects a manifest intended for another package', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...manifest, packageName: 'com.kestrelbrain.mobile.internal' }) }))
    await expect(checkForUpdate()).rejects.toThrow('does not match')
  })

  it('explains an unpublished release feed instead of exposing a bare 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(checkForUpdate()).rejects.toThrow('No update feed has been published yet')
  })
})
