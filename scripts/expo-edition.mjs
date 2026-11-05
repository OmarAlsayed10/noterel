import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const edition = process.argv[2]
if (edition !== 'public' && edition !== 'internal') throw new RangeError('Edition must be public or internal')
const expoCli = fileURLToPath(new URL('../node_modules/expo/bin/cli', import.meta.url))
const command = spawnSync(process.execPath, [expoCli, ...process.argv.slice(3)], { env: { ...process.env, KESTREL_EDITION: edition }, stdio: 'inherit' })
if (command.error) throw command.error
process.exitCode = command.status ?? 1
