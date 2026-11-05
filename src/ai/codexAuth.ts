import * as SecureStore from 'expo-secure-store'
import { beginCodexDeviceLogin, codexCredentialSchema, refreshCodexCredential, type CodexCredential } from './codexAuthProtocol'

const credentialKey = 'kestrel.mobile.codex.oauth.v1'
const secureStoreOptions: SecureStore.SecureStoreOptions = { keychainService: 'kestrel-mobile-codex' }
let refreshInFlight: Promise<CodexCredential> | null = null
let credentialEpoch = 0

export async function codexCredential(): Promise<CodexCredential | null> {
  if (!await SecureStore.isAvailableAsync()) throw new Error('Secure credential storage is unavailable')
  const stored = await SecureStore.getItemAsync(credentialKey, secureStoreOptions)
  if (!stored) return null
  try {
    return codexCredentialSchema.parse(JSON.parse(stored))
  } catch {
    await SecureStore.deleteItemAsync(credentialKey, secureStoreOptions)
    throw new Error('Saved Codex credentials are invalid. Sign in again.')
  }
}

const saveCredential = async (credential: CodexCredential): Promise<void> => {
  if (!await SecureStore.isAvailableAsync()) throw new Error('Secure credential storage is unavailable')
  await SecureStore.setItemAsync(credentialKey, JSON.stringify(codexCredentialSchema.parse(credential)), secureStoreOptions)
}

export async function startMobileCodexLogin(signal?: AbortSignal) {
  const login = await beginCodexDeviceLogin(fetch, signal)
  return {
    userCode: login.userCode,
    verificationUri: login.verificationUri,
    complete: async () => {
      const epoch = credentialEpoch
      const credential = await login.complete()
      if (epoch !== credentialEpoch) throw new Error('Codex sign-in was cancelled')
      await saveCredential(credential)
    }
  }
}

export async function activeCodexCredential(forceRefresh = false, signal?: AbortSignal): Promise<CodexCredential> {
  const stored = await codexCredential()
  if (!stored) throw new Error('Sign in to Codex in Settings first.')
  if (!forceRefresh && stored.expires > Date.now() + 60_000) return stored
  if (!refreshInFlight) {
    const epoch = credentialEpoch
    refreshInFlight = refreshCodexCredential(fetch, stored, signal).then(async refreshed => {
      if (epoch !== credentialEpoch) throw new Error('Codex was signed out')
      await saveCredential(refreshed)
      return refreshed
    }).finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

export async function signOutMobileCodex(): Promise<void> {
  credentialEpoch += 1
  await SecureStore.deleteItemAsync(credentialKey, secureStoreOptions)
}
