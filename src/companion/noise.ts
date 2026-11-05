import * as SecureStore from 'expo-secure-store'
import KestrelNoise from '../../modules/kestrel-noise'
import { isCanonicalNoiseKey } from './protocol'

const identityKey = 'kestrel.companion-noise-identity.v1'

interface NoiseKeyPair {
  readonly privateKey: string
  readonly publicKey: string
}

const execute = async <Result>(command: Record<string, unknown>): Promise<Result> => JSON.parse(await KestrelNoise.execute(JSON.stringify(command))) as Result

async function companionIdentity(): Promise<NoiseKeyPair> {
  const stored = await SecureStore.getItemAsync(identityKey)
  if (stored) {
    const parsed = JSON.parse(stored) as Partial<NoiseKeyPair>
    if (!parsed.privateKey || !parsed.publicKey || !isCanonicalNoiseKey(parsed.privateKey) || !isCanonicalNoiseKey(parsed.publicKey)) throw new Error('Stored companion identity is invalid')
    return { privateKey: parsed.privateKey, publicKey: parsed.publicKey }
  }
  const created = await execute<NoiseKeyPair>({ command: 'generateKeyPair' })
  if (!isCanonicalNoiseKey(created.privateKey) || !isCanonicalNoiseKey(created.publicKey)) throw new Error('Generated companion identity is invalid')
  await SecureStore.setItemAsync(identityKey, JSON.stringify(created))
  return created
}

export async function startNoise(mode: 'pairing' | 'device', desktopPublicKey: string): Promise<{ sessionId: string; message: string }> {
  if (!isCanonicalNoiseKey(desktopPublicKey)) throw new RangeError('Desktop public key is invalid')
  const identity = await companionIdentity()
  return execute({ command: 'start', mode, privateKey: identity.privateKey, desktopPublicKey })
}

export const readNoiseHandshake = (sessionId: string, message: string): Promise<{ payload: string; complete: boolean }> => execute({ command: 'readHandshake', sessionId, message })
export const writeNoiseHandshake = (sessionId: string, payload: string): Promise<{ message: string }> => execute({ command: 'writeHandshake', sessionId, payload })
export const encryptNoise = (sessionId: string, plaintext: string): Promise<{ message: string }> => execute({ command: 'encrypt', sessionId, plaintext })
export const decryptNoise = (sessionId: string, message: string): Promise<{ plaintext: string }> => execute({ command: 'decrypt', sessionId, message })
export const disposeNoise = async (sessionId: string): Promise<void> => { await execute({ command: 'dispose', sessionId }) }
