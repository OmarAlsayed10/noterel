import type { ConfigContext, ExpoConfig } from 'expo/config'

export type KestrelEdition = 'public' | 'internal'
export type AndroidDistribution = 'direct' | 'play'

const noterelUpdateManifestUrl = 'https://github.com/OmarAlsayed10/kestrel-brain-mobile/releases/latest/download/noterel-latest.json'

export const kestrelEdition = (requested: string | undefined): KestrelEdition => {
  if (!requested || requested === 'public') return 'public'
  if (requested === 'internal') return 'internal'
  throw new RangeError('KESTREL_EDITION must be public or internal')
}

export const editionConfig = (config: ConfigContext['config'], edition: KestrelEdition, distribution: AndroidDistribution): ExpoConfig => {
  const internal = edition === 'internal'
  const direct = distribution === 'direct'
  const permissions = direct ? config.android?.permissions : config.android?.permissions?.filter(permission => permission !== 'android.permission.REQUEST_INSTALL_PACKAGES')
  return {
    ...config,
    name: internal ? 'Noterel' : 'Kestrel Mobile',
    slug: config.slug ?? 'kestrel-brain-mobile',
    scheme: internal ? ['noterel', 'kestrel', 'notelin', 'acamar', 'kestrel-mobile-internal'] : 'kestrel-mobile',
    icon: config.icon,
    android: {
      ...config.android,
      package: internal ? 'com.siderynlabs.noterel' : 'com.kestrelbrain.mobile',
      permissions,
      adaptiveIcon: config.android?.adaptiveIcon
    },
    extra: { ...config.extra, transcriptionBetaUrl: process.env.EXPO_PUBLIC_TRANSCRIPTION_BETA_URL ?? config.extra?.transcriptionBetaUrl, edition, updateMode: distribution, updateManifestUrl: direct ? internal ? noterelUpdateManifestUrl : config.extra?.updateManifestUrl : undefined }
  }
}

export default ({ config }: ConfigContext): ExpoConfig => editionConfig(config, kestrelEdition(process.env.KESTREL_EDITION), process.env.KESTREL_PLAY_BUILD === 'true' ? 'play' : 'direct')
