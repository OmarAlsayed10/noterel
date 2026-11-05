import * as SecureStore from 'expo-secure-store'
import { applyThemeStyles } from './styles'
import { defaultTheme, fontScales, setTheme, type Theme } from './theme'

const themeKey = 'kestrel.theme'

const parseTheme = (raw: string | null): Theme => {
  if (!raw) return defaultTheme
  try {
    const parsed = JSON.parse(raw) as Partial<Theme>
    const fontScale = fontScales.find(scale => scale === parsed.fontScale) ?? 1
    return { mode: parsed.mode === 'dark' ? 'dark' : 'light', fontScale }
  } catch {
    return defaultTheme
  }
}

export async function loadTheme(): Promise<Theme> {
  const theme = parseTheme(await SecureStore.getItemAsync(themeKey).catch(() => null))
  setTheme(theme)
  applyThemeStyles(theme)
  return theme
}

export async function saveTheme(theme: Theme): Promise<void> {
  setTheme(theme)
  applyThemeStyles(theme)
  await SecureStore.setItemAsync(themeKey, JSON.stringify(theme))
}
