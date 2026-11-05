import { describe, expect, it, vi } from 'vitest'
import { beginCodexDeviceLogin, refreshCodexCredential } from '../../src/ai/codexAuthProtocol'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const accessToken = (accountId: string) => {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `${encode({ alg: 'none' })}.${encode({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } })}.signature`
}

describe('Codex device authentication', () => {
  it('exchanges an approved device code for bounded credentials', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/usercode')) return json({ device_auth_id: 'device-id', user_code: 'ABCD-1234', interval: 5 })
      if (url.endsWith('/deviceauth/token')) return json({ authorization_code: 'authorization-code', code_verifier: 'verifier' })
      if (url.endsWith('/oauth/token')) {
        expect(String(init?.body)).toContain('redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback')
        return json({ access_token: accessToken('account-123'), refresh_token: 'refresh-token', expires_in: 3600 })
      }
      throw new Error('Unexpected URL')
    })
    const login = await beginCodexDeviceLogin(fetcher)
    expect(login.userCode).toBe('ABCD-1234')
    await expect(login.complete()).resolves.toMatchObject({ accountId: 'account-123', refresh: 'refresh-token' })
  })

  it('does not expose provider response bodies when device login fails', async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith('/usercode')
      ? json({ device_auth_id: 'device-id', user_code: 'ABCD-1234', interval: 5 })
      : json({ error: { message: 'private provider detail' } }, 500))
    const login = await beginCodexDeviceLogin(fetcher)
    const completion = login.complete()
    await expect(completion).rejects.toThrow('OpenAI sign-in failed (500)')
    await expect(completion).rejects.not.toThrow('private provider detail')
  })

  it('refreshes access with the separately stored refresh token', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(String(init?.body)).toContain('grant_type=refresh_token')
      return json({ access_token: accessToken('account-456'), refresh_token: 'rotated-token', expires_in: 7200 })
    })
    await expect(refreshCodexCredential(fetcher, { access: 'old', refresh: 'refresh-token', expires: 1, accountId: 'account-456' })).resolves.toMatchObject({ accountId: 'account-456', refresh: 'rotated-token' })
  })
})
