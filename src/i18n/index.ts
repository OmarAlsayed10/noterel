import ar from './ar.json'
import en from './en.json'
import messagesArabic from './messages.ar.json'

export type Language = 'en' | 'ar'
export type TranslationKey = keyof typeof en

const dictionaries: Record<Language, Record<string, string>> = { en, ar }
const messages: Record<string, string> = messagesArabic
let current: Language = 'en'

export const currentLanguage = (): Language => current
export const setLanguage = (language: Language): void => { current = language }

export const t = (key: TranslationKey): string => dictionaries[current][key] ?? en[key] ?? key

export const tf = (key: TranslationKey, values: Record<string, string | number>): string => {
  const text = t(key).replace(/\{(\w+)\}/gu, (_match, name: string) => String(values[name] ?? ''))
  return text.replace('(s)', values.count === 1 ? '' : 's')
}

export const tm = (message: string): string => {
  if (current !== 'ar') return message
  const exact = messages[message]
  if (exact) return exact
  const separator = message.indexOf(': ')
  if (separator > 0) {
    const head = messages[message.slice(0, separator)]
    if (head) return `${head}: ${tm(message.slice(separator + 2))}`
  }
  return message
}

export const errorText = (error: unknown, fallback: TranslationKey): string => error instanceof Error ? tm(error.message) : t(fallback)
