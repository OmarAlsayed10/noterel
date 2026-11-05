import { fetch } from 'expo/fetch'
import { z } from 'zod'
import KestrelSourceProcessing from '../../../modules/kestrel-source-processing'
import { t, type TranslationKey } from '../../i18n'
import type { StoredCloudJob } from './protocol'

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string().optional() }) })
const errorKeys: Record<string, TranslationKey> = {
  activation_conflict: 'cloud.invite_redeemed',
  invalid_recording: 'cloud.invalid_audio',
  job_active: 'cloud.active_job',
  job_unavailable: 'cloud.job_missing',
  server_busy: 'cloud.service_unavailable',
  invalid_activation: 'cloud.invalid_invite',
  invalid_invitation: 'cloud.invalid_invite',
  invitation_redeemed: 'cloud.invite_redeemed',
  not_activated: 'cloud.activate_first',
  access_revoked: 'cloud.unauthorized',
  minutes_exhausted: 'cloud.no_minutes',
  recording_too_long: 'cloud.too_long',
  invalid_media: 'cloud.invalid_audio',
  empty_audio: 'cloud.invalid_audio',
  provider_failed: 'cloud.provider_failed',
  provider_invalid_response: 'cloud.provider_failed',
  job_interrupted: 'cloud.interrupted',
  provider_outcome_unknown: 'cloud.outcome_unknown',
  beta_expired: 'cloud.expired',
  budget_exhausted: 'cloud.budget_exhausted',
  server_restarting: 'cloud.interrupted',
  file_too_large: 'cloud.file_too_large',
  empty_upload: 'cloud.invalid_audio',
  job_missing: 'cloud.job_missing',
  rate_limited: 'cloud.rate_limited'
}

export const cloudErrorText = (code?: string | null): string => t(errorKeys[code ?? ''] ?? 'cloud.request_failed')

function cloudResponse(status: number, body: string): unknown {
  if (status === 204) return null
  if (body.length > 2 * 1024 * 1024) throw new Error(t('cloud.request_failed'))
  let decoded: unknown
  try { decoded = JSON.parse(body) } catch { throw new Error(t('cloud.request_failed')) }
  if (status < 200 || status >= 300) {
    const failure = errorSchema.safeParse(decoded)
    const code = failure.success ? failure.data.error.code : 'request_failed'
    throw Object.assign(new Error(cloudErrorText(code)), { code, status })
  }
  return decoded
}

export async function uploadCloudFile(token: string, job: StoredCloudJob): Promise<unknown> {
  if (!job.audioUri) throw new Error(t('cloud.audio_missing'))
  const response = await KestrelSourceProcessing.uploadTranscriptionBetaFile(job.audioUri, { url: `${job.endpoint}/v1/beta/jobs/${job.id}`, token, filename: job.filename, language: job.language })
  return cloudResponse(response.status, response.body)
}

export async function cloudRequest(endpoint: string, path: string, options: { readonly token?: string; readonly method?: string; readonly body?: BodyInit; readonly headers?: Record<string, string> } = {}): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`${endpoint}/v1/beta${path}`, { method: options.method, body: options.body, signal: controller.signal, redirect: 'error', headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...options.headers } })
    return cloudResponse(response.status, await response.text())
  } finally {
    clearTimeout(timer)
  }
}
