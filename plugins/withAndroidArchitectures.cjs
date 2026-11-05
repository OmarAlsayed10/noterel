const { withGradleProperties } = require('expo/config-plugins')

module.exports = config => withGradleProperties(config, gradleConfig => {
  const architectures = process.env.KESTREL_PLAY_BUILD === 'true' ? 'armeabi-v7a,arm64-v8a,x86,x86_64' : 'arm64-v8a'
  const property = gradleConfig.modResults.find(item => item.type === 'property' && item.key === 'reactNativeArchitectures')
  if (property) property.value = architectures
  else gradleConfig.modResults.push({ type: 'property', key: 'reactNativeArchitectures', value: architectures })
  return gradleConfig
})
