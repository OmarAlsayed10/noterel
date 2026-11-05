const { withAppBuildGradle } = require('expo/config-plugins')

const propertiesLookup = `
def releaseSigning = new Properties()
def releaseSigningFile = file(System.getenv('KESTREL_ANDROID_SIGNING_PROPERTIES') ?: "\${System.getProperty('user.home')}/.kestrel/mobile-release-signing.properties")
if (releaseSigningFile.exists()) releaseSigningFile.withInputStream { releaseSigning.load(it) }
`

const releaseSigningConfig = `        release {
            if (releaseSigningFile.exists()) {
                storeFile file(releaseSigning['storeFile'])
                storePassword releaseSigning['storePassword']
                keyAlias releaseSigning['keyAlias']
                keyPassword releaseSigning['keyPassword']
            }
        }
`

const applyReleaseSigning = contents => {
  if (contents.includes('releaseSigningFile')) return contents
  const withLookup = contents.replace(/\nandroid \{/, `${propertiesLookup}\nandroid {`)
  const withConfig = withLookup.replace(/(    signingConfigs \{\n        debug \{[\s\S]*?\n        \}\n)/, `$1${releaseSigningConfig}`)
  return withConfig.replace(/(    buildTypes \{[\s\S]*?        release \{[\s\S]*?)signingConfig signingConfigs\.debug/, '$1signingConfig releaseSigningFile.exists() ? signingConfigs.release : signingConfigs.debug')
}

module.exports = config => withAppBuildGradle(config, gradleConfig => {
  gradleConfig.modResults.contents = applyReleaseSigning(gradleConfig.modResults.contents)
  return gradleConfig
})

module.exports.applyReleaseSigning = applyReleaseSigning
