import { z } from 'zod'

const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann'
const authBaseUrl = 'https://auth.openai.com'
const deviceRedirectUri = `${authBaseUrl}/deviceauth/callback`
const deviceTimeoutMs = 15 * 60 * 1000

const deviceResponseSchema = z.object({
  device_auth_id: z.string().min(1).max(2048),
  user_code: z.string().min(1).max(128),
  interval: z.union([z.number(), z.string()]).transform(value => Number(value)).pipe(z.number().finite().min(0).max(60))
}).passthrough()

const deviceTokenSchema = z.object({
  authorization_code: z.string().min(1).max(8192),
  code_verifier: z.string().min(1).max(8192)
}).passthrough()

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(65536),
  refresh_token: z.string().min(1).max(65536),
  expires_in: z.number().finite().positive().max(31_536_000)
}).passthrough()

export const codexCredentialSchema = z.object({
  access: z.string().min(1).max(65536),
  refresh: z.string().min(1).max(65536),
  expires: z.number().int().positive(),
  accountId: z.string().min(1).max(1024)
}).strict()

export type CodexCredential = z.infer<typeof codexCredentialSchema>
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

const delay = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(new Error('Login cancelled'))
    return
  }
  const aborted = () => {
    clearTimeout(timer)
    reject(new Error('Login cancelled'))
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', aborted)
    resolve()
  }, milliseconds)
  signal?.addEventListener('abort', aborted, { once: true })
})

const base64UrlText = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
}

const accountIdFromAccessToken = (access: string): string => {
  try {
    const payload = JSON.parse(base64UrlText(access.split('.')[1] ?? '')) as Record<string, unknown>
    const auth = payload['https://api.openai.com/auth']
    if (!auth || typeof auth !== 'object') throw new Error('Missing account')
    const accountId = (auth as Record<string, unknown>).chatgpt_account_id
    if (typeof accountId !== 'string' || !accountId) throw new Error('Missing account')
    return accountId
  } catch {
    throw new Error('OpenAI account information is invalid')
  }
}

const credentialFromResponse = async (response: Response): Promise<CodexCredential> => {
  if (!response.ok) throw new Error(`OpenAI token request failed (${response.status})`)
  const token = tokenResponseSchema.parse(await response.json())
  return codexCredentialSchema.parse({ access: token.access_token, refresh: token.refresh_token, expires: Date.now() + Math.floor(token.expires_in * 1000), accountId: accountIdFromAccessToken(token.access_token) })
}

const exchangeDeviceCode = async (fetcher: Fetcher, authorizationCode: string, codeVerifier: string, signal?: AbortSignal): Promise<CodexCredential> => credentialFromResponse(await fetcher(`${authBaseUrl}/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: authorizationCode, code_verifier: codeVerifier, redirect_uri: deviceRedirectUri }).toString(),
  signal
}))

interface CodexDeviceLogin {
  readonly userCode: string
  readonly verificationUri: string
  readonly complete: () => Promise<CodexCredential>
}

export async function beginCodexDeviceLogin(fetcher: Fetcher, signal?: AbortSignal): Promise<CodexDeviceLogin> {
  const response = await fetcher(`${authBaseUrl}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId }),
    signal
  })
  if (!response.ok) throw new Error(`OpenAI sign-in could not start (${response.status})`)
  const device = deviceResponseSchema.parse(await response.json())
  const startedAt = Date.now()
  return {
    userCode: device.user_code,
    verificationUri: `${authBaseUrl}/codex/device`,
    complete: async () => {
      let intervalMs = Math.max(1000, Math.floor(device.interval * 1000))
      while (Date.now() - startedAt < deviceTimeoutMs) {
        const poll = await fetcher(`${authBaseUrl}/api/accounts/deviceauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_auth_id: device.device_auth_id, user_code: device.user_code }),
          signal
        })
        if (poll.ok) {
          const token = deviceTokenSchema.parse(await poll.json())
          return exchangeDeviceCode(fetcher, token.authorization_code, token.code_verifier, signal)
        }
        if (poll.status !== 403 && poll.status !== 404) {
          const body = await poll.json().catch(() => null) as { error?: string | { code?: string } } | null
          const code = typeof body?.error === 'string' ? body.error : body?.error?.code
          if (code === 'slow_down') intervalMs = Math.min(60_000, intervalMs + 5000)
          else throw new Error(`OpenAI sign-in failed (${poll.status})`)
        }
        await delay(intervalMs, signal)
      }
      throw new Error('OpenAI sign-in timed out')
    }
  }
}

export async function refreshCodexCredential(fetcher: Fetcher, credential: CodexCredential, signal?: AbortSignal): Promise<CodexCredential> {
  return credentialFromResponse(await fetcher(`${authBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credential.refresh, client_id: clientId }).toString(),
    signal
  }))
}
