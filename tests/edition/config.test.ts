import { describe, expect, it } from 'vitest'
import { editionConfig, kestrelEdition } from '../../app.config'

const baseConfig = { name: 'Kestrel Mobile', slug: 'kestrel-brain-mobile', android: { package: 'com.kestrelbrain.mobile', permissions: ['android.permission.POST_NOTIFICATIONS', 'android.permission.REQUEST_INSTALL_PACKAGES'] }, extra: { updateManifestUrl: 'https://example.com/latest.json' } }

describe('Kestrel build editions', () => {
  it.each([
    ['public', 'Kestrel Mobile', 'com.kestrelbrain.mobile', 'kestrel-mobile', 'https://example.com/latest.json'],
    ['internal', 'Noterel', 'com.siderynlabs.noterel', ['noterel', 'kestrel', 'notelin', 'acamar', 'kestrel-mobile-internal'], 'https://github.com/OmarAlsayed10/kestrel-brain-mobile/releases/latest/download/noterel-latest.json']
  ] as const)('configures the %s direct Android application independently', (edition, name, packageName, scheme, updateManifestUrl) => {
    const configured = editionConfig(baseConfig, edition, 'direct')
    expect(configured).toMatchObject({ name, scheme, android: { package: packageName }, extra: { edition, updateMode: 'direct' } })
    expect(configured.extra?.updateManifestUrl).toBe(updateManifestUrl)
    expect(configured.android?.permissions).toContain('android.permission.REQUEST_INSTALL_PACKAGES')
    expect(configured.icon).toBeUndefined()
    expect(configured.android?.adaptiveIcon?.foregroundImage).toBeUndefined()
  })

  it('keeps the Noterel Play build on store-managed updates', () => {
    const configured = editionConfig(baseConfig, 'internal', 'play')
    expect(configured.extra).toMatchObject({ edition: 'internal', updateMode: 'play', updateManifestUrl: undefined })
    expect(configured.android?.permissions).not.toContain('android.permission.REQUEST_INSTALL_PACKAGES')
  })

  it('rejects unknown release editions', () => {
    expect(() => kestrelEdition('preview')).toThrow('public or internal')
  })
})
