import { Linking } from 'react-native'

export const safeHttpUrl = (value: string | null): URL | null => {
  if (!value) return null
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}

export const openHttpUrl = (value: string): void => {
  const url = safeHttpUrl(value)
  if (url) void Linking.openURL(url.toString())
}
