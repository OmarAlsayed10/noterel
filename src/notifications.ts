import { PermissionsAndroid, Platform } from 'react-native'

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || Platform.Version < 33) return true
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
  if (await PermissionsAndroid.check(permission)) return true
  return await PermissionsAndroid.request(permission) === PermissionsAndroid.RESULTS.GRANTED
}
