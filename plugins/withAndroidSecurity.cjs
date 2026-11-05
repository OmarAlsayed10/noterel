const { withAndroidManifest } = require('expo/config-plugins')

module.exports = config => withAndroidManifest(config, androidConfig => {
  const manifest = androidConfig.modResults.manifest
  const application = manifest.application[0].$
  manifest['uses-permission'] = (manifest['uses-permission'] ?? []).filter(permission => permission.$?.['android:name'] !== 'android.permission.SYSTEM_ALERT_WINDOW')
  application['android:allowBackup'] = 'false'
  delete application['android:fullBackupContent']
  delete application['android:dataExtractionRules']
  return androidConfig
})
