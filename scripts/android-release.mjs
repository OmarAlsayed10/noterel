import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const edition = process.argv[2]
const format = process.argv[3]
if (!['public', 'internal'].includes(edition) || !['apk', 'aab'].includes(format)) throw new RangeError('Usage: android-release.mjs <public|internal> <apk|aab>')
const root = fileURLToPath(new URL('..', import.meta.url))
const config = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8')).expo
const environment = { ...process.env, KESTREL_EDITION: edition, KESTREL_PLAY_BUILD: format === 'aab' ? 'true' : 'false', NODE_ENV: 'production' }
const expo = fileURLToPath(new URL('../node_modules/expo/bin/cli', import.meta.url))
const androidDirectory = path.join(root, 'android')
const gradle = `"${path.join(androidDirectory, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')}"`
if (existsSync(gradle.slice(1, -1))) {
  spawnSync(gradle, ['--stop'], { cwd: androidDirectory, env: environment, shell: true, stdio: 'inherit' })
  await new Promise(resolve => setTimeout(resolve, 2000))
}
const prebuild = spawnSync(process.execPath, [expo, 'prebuild', '--clean', '--platform', 'android', '--no-install'], { cwd: root, env: environment, stdio: 'inherit' })
if (prebuild.error) throw prebuild.error
if (prebuild.status !== 0) process.exit(prebuild.status ?? 1)
const task = format === 'aab' ? 'bundleRelease' : 'assembleRelease'
const build = spawnSync(gradle, [task], { cwd: androidDirectory, env: environment, shell: true, stdio: 'inherit' })
spawnSync(gradle, ['--stop'], { cwd: androidDirectory, env: environment, shell: true, stdio: 'inherit' })
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)
const source = format === 'aab' ? path.join(root, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab') : path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
const target = path.join(root, 'dist', edition === 'public' ? `kestrel-owner-${config.version}.${format}` : `noterel-${config.version}.${format}`)
mkdirSync(path.dirname(target), { recursive: true })
copyFileSync(source, target)
console.log(target)
