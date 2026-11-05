const { withAppBuildGradle } = require('expo/config-plugins')

const dependency = '    implementation files("$rootDir/../modules/kestrel-source-processing/android/libs/sherpa-onnx-1.13.8.aar")'

module.exports = config => withAppBuildGradle(config, result => {
  if (!result.modResults.contents.includes(dependency)) {
    result.modResults.contents = result.modResults.contents.replace('dependencies {', `dependencies {\n${dependency}`)
  }
  return result
})
