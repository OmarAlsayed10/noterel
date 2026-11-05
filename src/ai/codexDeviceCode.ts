import * as Clipboard from 'expo-clipboard'
import { Linking } from 'react-native'
import KestrelDeviceCode from '../../modules/kestrel-device-code'
import { requestNotificationPermission } from '../notifications'

export async function copyCodexDeviceCode(code: string): Promise<void> {
  await Clipboard.setStringAsync(code)
}

export async function openCodexDeviceLogin(code: string, url: string): Promise<boolean> {
  await copyCodexDeviceCode(code)
  const notificationVisible = await requestNotificationPermission()
  if (notificationVisible) await KestrelDeviceCode.show(code)
  await Linking.openURL(url)
  return notificationVisible
}

export function dismissCodexDeviceCode(): Promise<void> {
  return KestrelDeviceCode.dismiss()
}
