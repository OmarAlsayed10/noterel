import { tm } from '../../i18n'
import { videoRecoveryCopy } from './videoRecoveryCopy'

const knownErrors = [
  'Choose audio or video no larger than 128 MiB',
  'Choose audio no larger than 128 MiB',
  'Facebook did not expose downloadable audio for this video. Choose a video file instead.',
  'Facebook video audio exceeds 128 MiB. Choose a smaller video file.',
  'Facebook video preparation timed out',
  'Facebook video audio is empty',
  'Facebook did not return playable video audio',
  'Facebook media URL is invalid',
  'Facebook media redirect is missing',
  'Facebook media redirected too many times',
  'Facebook URL is invalid',
  'Facebook redirected away from facebook.com'
]

export function videoRecoveryErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null
  const known = knownErrors.find(message => error.message.endsWith(message))
  if (known) return tm(known)
  const httpStatus = error.message.match(/Facebook (?:returned HTTP |video audio could not be downloaded \()(\d{3})(?:\)\. Choose a video file instead\.)?$/u)?.[1]
  if (httpStatus) return videoRecoveryCopy('httpFailure').replace('{status}', httpStatus)
  return /(?:^|[:\s])(?:timeout|timed out)$/iu.test(error.message) ? tm('Facebook video preparation timed out') : null
}
