import Constants from 'expo-constants'

export type KestrelEdition = 'public' | 'internal'

export const appEdition: KestrelEdition = Constants.expoConfig?.extra?.edition === 'internal' ? 'internal' : 'public'
export const codexEnabled = appEdition === 'public'
export const appDisplayName = Constants.expoConfig?.name ?? (appEdition === 'internal' ? 'Noterel' : 'Kestrel Mobile')
export const appScheme = Array.isArray(Constants.expoConfig?.scheme) ? Constants.expoConfig.scheme[0] : Constants.expoConfig?.scheme ?? 'kestrel-mobile'
export const directUpdatesEnabled = Constants.expoConfig?.extra?.updateMode === 'direct'
