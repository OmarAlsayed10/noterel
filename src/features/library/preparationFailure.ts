import { tm } from '../../i18n'
import { videoRecoveryCopy } from '../capture/videoRecoveryCopy'

const unavailableCaptions = new Set([
  'Facebook did not expose post text or captions. Share an audio file here for Whisper transcription, or use Add → Audio on Desktop.',
  'TikTok did not expose captions. Share an audio file here for Whisper transcription, or use Add → Audio on Desktop.',
  'This YouTube video has no accessible captions. Import the video file for local transcription.'
])

export const preparationFailureMessage = (message: string): string => unavailableCaptions.has(message) ? videoRecoveryCopy('noCaptions') : tm(message)
