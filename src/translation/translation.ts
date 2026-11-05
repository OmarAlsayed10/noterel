import { z } from 'zod'
import KestrelSourceProcessing from '../../modules/kestrel-source-processing'
import { currentLanguage, t, tf } from '../i18n'
import { requestNotificationPermission } from '../notifications'

const translationSourceMaximumBytes = 64 * 1024
const languageCodeSchema = z.enum(['ar', 'de', 'en', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'zh'])
const translatedTextSchema = z.object({ sourceLanguage: z.string().min(2).max(8), text: z.string().max(256 * 1024) })
const translationDownloadSchema = z.object({ language: languageCodeSchema, state: z.enum(['idle', 'queued', 'downloading', 'succeeded', 'failed', 'cancelled']), error: z.string().nullable().optional() })

export type TranslationLanguageCode = z.infer<typeof languageCodeSchema>

const languages: readonly { readonly code: TranslationLanguageCode; readonly en: string; readonly ar: string }[] = [
  { code: 'ar', en: 'Arabic', ar: 'العربية' },
  { code: 'en', en: 'English', ar: 'الإنجليزية' },
  { code: 'fr', en: 'French', ar: 'الفرنسية' },
  { code: 'de', en: 'German', ar: 'الألمانية' },
  { code: 'es', en: 'Spanish', ar: 'الإسبانية' },
  { code: 'it', en: 'Italian', ar: 'الإيطالية' },
  { code: 'pt', en: 'Portuguese', ar: 'البرتغالية' },
  { code: 'tr', en: 'Turkish', ar: 'التركية' },
  { code: 'ru', en: 'Russian', ar: 'الروسية' },
  { code: 'zh', en: 'Chinese', ar: 'الصينية' },
  { code: 'ja', en: 'Japanese', ar: 'اليابانية' },
  { code: 'ko', en: 'Korean', ar: 'الكورية' },
  { code: 'hi', en: 'Hindi', ar: 'الهندية' },
  { code: 'id', en: 'Indonesian', ar: 'الإندونيسية' }
]

const boundedUtf8 = (text: string): string => {
  if (new TextEncoder().encode(text).byteLength <= translationSourceMaximumBytes) return text
  let lower = 0
  let upper = Math.min(text.length, translationSourceMaximumBytes)
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2)
    if (new TextEncoder().encode(text.slice(0, middle)).byteLength <= translationSourceMaximumBytes) lower = middle
    else upper = middle - 1
  }
  const end = lower > 0 && text.charCodeAt(lower - 1) >= 0xd800 && text.charCodeAt(lower - 1) <= 0xdbff ? lower - 1 : lower
  return text.slice(0, end)
}

export const translationLanguages = () => languages.map(language => ({ code: language.code, label: currentLanguage() === 'ar' ? language.ar : language.en }))

export const translationLanguageLabel = (code: string): string => {
  const language = languages.find(candidate => candidate.code === code)
  return language ? currentLanguage() === 'ar' ? language.ar : language.en : code.toUpperCase()
}

export async function installedTranslationModels(): Promise<readonly TranslationLanguageCode[]> {
  const installed = await KestrelSourceProcessing.downloadedTranslationModels()
  return installed.map(code => languageCodeSchema.safeParse(code)).filter(result => result.success).map(result => result.data)
}

export async function downloadTranslationModel(language: TranslationLanguageCode): Promise<void> {
  if ((await installedTranslationModels()).includes(language)) return
  await requestNotificationPermission()
  await KestrelSourceProcessing.downloadTranslationModel(language, currentLanguage())
}
export const translationModelDownloadStates = async () => z.array(translationDownloadSchema).parse(await KestrelSourceProcessing.translationModelDownloadStates(languages.map(language => language.code)))
export const deleteTranslationModel = (language: TranslationLanguageCode): Promise<void> => KestrelSourceProcessing.deleteTranslationModel(language)

export async function translateReading(text: string, targetLanguage: TranslationLanguageCode): Promise<{ readonly sourceLanguage: string; readonly text: string; readonly truncated: boolean }> {
  const source = boundedUtf8(text)
  try {
    const translated = translatedTextSchema.parse(await KestrelSourceProcessing.translateText(source, targetLanguage))
    return { ...translated, truncated: source.length !== text.length }
  } catch (error) {
    const missingCode = error instanceof Error ? error.message.match(/Download the ([a-z]{2}) translation pack first/iu)?.[1] : null
    const missingLanguage = missingCode ? languageCodeSchema.safeParse(missingCode) : null
    if (missingLanguage?.success) throw new Error(tf('translation.pack_required', { language: translationLanguageLabel(missingLanguage.data) }))
    throw new Error(t('translation.translation_failed'))
  }
}
