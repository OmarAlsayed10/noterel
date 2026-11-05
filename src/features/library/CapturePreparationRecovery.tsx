import { Text, View } from 'react-native'
import { Button } from '../../components/ui'
import { t } from '../../i18n'
import { openHttpUrl, safeHttpUrl } from '../../links'
import { facebookVideoUrl } from '../../sources/facebook'
import { tiktokVideoUrl } from '../../sources/tiktok'
import { youtubeVideoId } from '../../sources/youtube'
import { styles } from '../../theme/styles'
import { videoRecoveryCopy } from '../capture/videoRecoveryCopy'
import { preparationFailureMessage } from './preparationFailure'
import type { CardMenuOption } from '../../types'

export interface VideoRecoveryActions {
  readonly pendingUrl: string | null
  readonly choosingFile: boolean
  readonly transcribe: (url: string, captureId?: string) => void
  readonly choose: (url?: string, captureId?: string) => void
  readonly cancel: () => void
  readonly invalidate: () => void
}

function recoveryMedia(url: string) {
  const parsed = safeHttpUrl(url)
  if (!parsed) return null
  const facebook = facebookVideoUrl(url)
  const video = facebook || tiktokVideoUrl(url) || youtubeVideoId(url) !== null || /(^|\.)instagram\.com$/u.test(parsed.hostname) && /^\/(?:reel|reels)\//u.test(parsed.pathname)
  return { facebook, video }
}

export function captureRecoveryMenu({ url, captureId, retry, recovery }: { readonly url: string; readonly captureId: string; readonly retry: () => void; readonly recovery: VideoRecoveryActions }): readonly CardMenuOption[] {
  const media = recoveryMedia(url)
  if (!media) return []
  const busy = recovery.pendingUrl !== null || recovery.choosingFile
  return [
    { label: videoRecoveryCopy('open'), action: () => openHttpUrl(url) },
    ...(!busy && media.facebook ? [{ label: videoRecoveryCopy('retry'), action: retry }] : []),
    ...(!busy && media.video ? [{ label: videoRecoveryCopy('choose'), action: () => recovery.choose(url, captureId) }] : [])
  ]
}

export function CapturePreparationRecovery({ url, captureId, failureMessage, retry, recovery }: { readonly url: string; readonly captureId: string; readonly failureMessage: string | null; readonly retry: () => void; readonly recovery: VideoRecoveryActions }) {
  const media = recoveryMedia(url)
  if (!media) return null
  const pending = recovery.pendingUrl === url
  const busy = recovery.pendingUrl !== null || recovery.choosingFile
  return <View style={{ gap: 10, marginTop: 12 }}>
    {failureMessage && <Text accessibilityLiveRegion="polite" style={styles.capabilityDetail}>{preparationFailureMessage(failureMessage)}</Text>}
    <Button label={media.facebook ? videoRecoveryCopy('transcribe') : failureMessage ? videoRecoveryCopy('retry') : videoRecoveryCopy('prepare')} onPress={media.facebook ? () => recovery.transcribe(url, captureId) : retry} busy={pending} disabled={busy && !pending} />
    {pending && <Button label={t('common.cancel')} onPress={recovery.cancel} variant="secondary" />}
    {pending && <Text accessibilityLiveRegion="polite" style={styles.capabilityDetail}>{videoRecoveryCopy('preparing')} {videoRecoveryCopy('preparingDetail')}</Text>}
  </View>
}
