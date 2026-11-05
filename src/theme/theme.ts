export type ThemeMode = 'light' | 'dark'

export interface Theme {
  readonly mode: ThemeMode
  readonly fontScale: number
}

export const defaultTheme: Theme = { mode: 'light', fontScale: 1 }
export const fontScales = [0.85, 1, 1.15, 1.3, 1.5] as const

const lightColors = {
  background: '#F1F5F9', surface: '#FFFFFF', tonal: '#E8EEF4', text: '#172B3A', secondaryText: '#526477',
  primary: '#0F766E', onPrimary: '#FFFFFF', link: '#0F766E', outline: '#CBD5E1', success: '#176B53', successSurface: '#E4F2ED',
  warning: '#805713', warningSurface: '#FFF1D6', error: '#AA3434', errorSurface: '#FCEAEA', darkSurface: '#172B3A'
}

const darkColors: typeof lightColors = {
  background: '#0F1722', surface: '#192633', tonal: '#243544', text: '#E8F0F5', secondaryText: '#B2C2CE',
  primary: '#115E59', onPrimary: '#FFFFFF', link: '#8CD3C7', outline: '#405365', success: '#8CD3B7', successSurface: '#1D3B32',
  warning: '#F1C77D', warningSurface: '#3A3020', error: '#F4A9A9', errorSurface: '#44292D', darkSurface: '#111E2A'
}

const surfaceAliases = (colors: typeof lightColors): Record<string, string> => ({
  '#17253B': colors.darkSurface, '#101C2E': colors.darkSurface, '#223653': colors.tonal, '#314866': colors.outline,
  '#F1F5F9': colors.background, '#F5F1E8': colors.surface, '#FFFDF7': colors.surface, '#FFFFFF': colors.surface,
  '#E5E1D8': colors.tonal, '#E4E0D8': colors.tonal, '#DDE2E2': colors.tonal, '#D8E4F1': colors.tonal,
  '#E8E5DC': colors.tonal, '#EEF0EA': colors.tonal, '#E8EEF0': colors.successSurface,
  '#D8D6CF': colors.outline, '#D8D2C7': colors.outline, '#B8C8DD': colors.outline, '#AEB4BA': colors.outline,
  '#8395AD': colors.outline, '#C8C5BC': colors.outline, '#354052': colors.outline,
  '#EFE1CC': colors.warningSurface, '#F3E3D5': colors.warningSurface, '#F0C878': colors.warningSurface,
  '#E2ECE8': colors.successSurface, '#F0A49F': colors.errorSurface, '#D59B55': colors.primary,
  '#2E7D68': colors.success, '#96713F': colors.warning, '#A53E3A': colors.error, '#B4432F': '#AA3434'
})

const inkAliases = (colors: typeof lightColors): Record<string, string> => ({
  '#17253B': colors.text, '#101C2E': colors.text, '#223653': colors.text, '#354052': colors.text,
  '#536071': colors.secondaryText, '#697283': colors.secondaryText, '#AEB4BA': colors.secondaryText,
  '#8395AD': colors.secondaryText, '#B8C8DD': '#D4E1E8', '#CBD4E0': '#D4E1E8', '#AEBBCD': '#B2C2CE',
  '#2E5E78': colors.link, '#D59B55': colors.success, '#2E7D68': colors.success,
  '#96713F': colors.warning, '#76542D': colors.warning, '#7A5633': colors.success,
  '#B17835': colors.success, '#F0C68E': '#A4E4D2', '#A53E3A': colors.error,
  '#F5F1E8': colors.onPrimary, '#E7EDF5': '#E8F0F5', '#523C65': colors.secondaryText
})

export interface ThemeTokens {
  readonly colors: typeof lightColors
  readonly surface: (hex: string) => string
  readonly ink: (hex: string) => string
  readonly font: (size: number) => number
}

export const themeTokens = (theme: Theme): ThemeTokens => {
  const colors = theme.mode === 'dark' ? darkColors : lightColors
  const surfaces = surfaceAliases(colors)
  const inks = inkAliases(colors)
  return {
    colors,
    surface: hex => surfaces[hex.toUpperCase()] ?? hex,
    ink: hex => inks[hex.toUpperCase()] ?? hex,
    font: size => Math.round(size * theme.fontScale)
  }
}

let current: Theme = defaultTheme
export const currentTheme = (): Theme => current
export const setTheme = (theme: Theme): void => { current = theme }
