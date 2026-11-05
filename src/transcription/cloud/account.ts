import Constants from 'expo-constants'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { z } from 'zod'
import { base64Url } from '../../bytes'
import { t } from '../../i18n'
import { cloudAccountSchema, cloudEndpoint } from './protocol'
import { cloudRequest } from './transport'

const accessKey = 'kestrel.transcription-beta.v1'
const accessSchema = z.object({
  endpoint: z.string().transform(cloudEndpoint),
  accountId: z.string().uuid().optional(),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u).optional(),
  activation: z.object({ code: z.string(), activationId: z.string().uuid(), activationSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).optional()
})
export type CloudAccess = z.infer<typeof accessSchema>

export const resetCloudAccess = (): Promise<void> => SecureStore.deleteItemAsync(accessKey)

export async function cloudAccess(): Promise<CloudAccess | null> {
  const stored = await SecureStore.getItemAsync(accessKey)
  if (stored) return accessSchema.parse(JSON.parse(stored))
  const configured = Constants.expoConfig?.extra?.transcriptionBetaUrl
  return typeof configured === 'string' && configured ? { endpoint: cloudEndpoint(configured) } : null
}

export async function configureCloudEndpoint(endpoint: string): Promise<void> {
  const current = await cloudAccess()
  let normalized: string
  try { normalized = cloudEndpoint(endpoint) }
  catch { throw new Error(t('cloud.invalid_endpoint')) }
  if ((current?.token || current?.activation) && current.endpoint !== normalized) throw new Error(t('cloud.endpoint_locked'))
  await SecureStore.setItemAsync(accessKey, JSON.stringify({ ...current, endpoint: normalized }))
}

export async function activateCloudBeta(code: string): Promise<void> {
  const access = await cloudAccess()
  if (!access) throw new Error(t('cloud.configure_first'))
  const normalizedCode = code.replace(/[\s-]/gu, '').toUpperCase()
  if (!normalizedCode || normalizedCode.length > 256) throw new Error(t('cloud.invalid_invite'))
  if (access.activation && access.activation.code !== normalizedCode) throw new Error(t('cloud.activation_pending'))
  const activation = access.activation?.code === normalizedCode ? access.activation : { code: normalizedCode, activationId: Crypto.randomUUID(), activationSecret: base64Url(await Crypto.getRandomBytesAsync(32)) }
  await SecureStore.setItemAsync(accessKey, JSON.stringify({ ...access, activation }))
  let activated
  try {
    activated = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u), account: cloudAccountSchema }).parse(await cloudRequest(access.endpoint, '/activate', { method: 'POST', body: JSON.stringify(activation), headers: { 'Content-Type': 'application/json' } }))
  } catch (error) {
    if (error instanceof Error && 'code' in error && ['invalid_invitation', 'invalid_activation', 'invitation_redeemed', 'activation_conflict'].includes(String(error.code))) {
      const { activation: _pending, ...remaining } = access
      await SecureStore.setItemAsync(accessKey, JSON.stringify(remaining))
    }
    throw error
  }
  await SecureStore.setItemAsync(accessKey, JSON.stringify({ endpoint: access.endpoint, accountId: activated.account.accountId, token: activated.token }))
}

export async function authenticatedCloudAccess(): Promise<CloudAccess & { readonly token: string; readonly accountId: string }> {
  const access = await cloudAccess()
  if (!access?.token || !access.accountId) throw new Error(t('cloud.activate_first'))
  return { ...access, token: access.token, accountId: access.accountId }
}

export async function cloudAccount() {
  const access = await authenticatedCloudAccess()
  return cloudAccountSchema.parse(await cloudRequest(access.endpoint, '/account', { token: access.token }))
}
