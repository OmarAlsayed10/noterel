import * as SecureStore from 'expo-secure-store'
import { I18nManager } from 'react-native'
import { setLanguage, type Language } from './index'

const languageKey = 'kestrel.language'

export async function loadLanguage(): Promise<Language> {
  const stored = await SecureStore.getItemAsync(languageKey).catch(() => null)
  const language: Language = stored === 'ar' ? 'ar' : 'en'
  setLanguage(language)
  return language
}

export async function saveLanguage(language: Language): Promise<void> {
  setLanguage(language)
  await SecureStore.setItemAsync(languageKey, language)
  const rtl = language === 'ar'
  I18nManager.allowRTL(rtl)
  I18nManager.forceRTL(rtl)
}
