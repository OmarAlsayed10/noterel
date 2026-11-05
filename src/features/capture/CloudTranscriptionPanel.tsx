import { useEffect, useRef, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { Button } from '../../components/ui'
import { errorText, t, tf } from '../../i18n'
import { cloudAccount } from '../../transcription/cloud/account'
import { retryCloudUpload, startCloudTranscription } from '../../transcription/cloud/jobs'
import type { CloudAccount } from '../../transcription/cloud/protocol'
import { discardTemporaryAudio, type AudioCandidate, type TranscriptionLanguage } from '../../transcription/transcription'
import { styles } from '../../theme/styles'
import { TranscriptionLanguageOptions } from './TranscriptionLanguageOptions'
import { VideoSourcePreview } from './VideoSourcePreview'

export interface TranscriptionCaptureProps {
  readonly audio: AudioCandidate
  readonly cancel: () => void
  readonly openSettings: () => void
  readonly started: () => void
  readonly cloudStarted?: () => void
  readonly busyChanged?: (busy: boolean) => void
  readonly compact: boolean
  readonly active?: boolean
}

export function CloudTranscriptionPanel({ audio, cancel, openSettings, started, cloudStarted, busyChanged, compact, active = true }: TranscriptionCaptureProps) {
  const [language, setLanguage] = useState<TranscriptionLanguage>('auto')
  const [account, setAccount] = useState<CloudAccount | null>(null)
  const [expired, setExpired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { busyChanged?.(busy) }, [busy, busyChanged])
  useEffect(() => {
    if (!active) return
    let current = true
    void cloudAccount().then(balance => { if (current) { setAccount(balance); setExpired(Date.parse(balance.expiresAt) <= Date.now()); setMessage(null) } }).catch(error => { if (current) { setAccount(null); setMessage(errorText(error, 'cloud.request_failed')) } })
    return () => { current = false }
  }, [active])
  const transcribe = () => {
    Alert.alert(t('cloud.send_title'), t('cloud.disclosure'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('cloud.send'), onPress: () => {
        setBusy(true)
        void startCloudTranscription(audio, language).then(async id => {
          discardTemporaryAudio(audio)
          try { await retryCloudUpload(id) }
          finally { if (mounted.current) (cloudStarted ?? started)() }
        }).catch(error => { if (mounted.current) setMessage(errorText(error, 'cloud.request_failed')) }).finally(() => { if (mounted.current) setBusy(false) })
      } }
    ])
  }
  return <View style={compact ? styles.quickCaptureCard : styles.panel}>
    <Text style={styles.panelTitle}>{t('cloud.title')}</Text>
    <Text numberOfLines={2} style={styles.capabilityName}>{audio.filename}</Text>
    <Text style={[styles.capabilityDetail, styles.blockButton]}>{t('cloud.beta_description')}</Text>
    {audio.origin && <VideoSourcePreview source={audio.origin} />}
    {account && <Text style={[styles.capabilityDetail, styles.blockButton]}>{tf('cloud.available_minutes', { minutes: Math.floor(account.remainingSeconds / 60) })}</Text>}
    {account && expired && <Text style={[styles.staleNotice, styles.blockButton]}>{t('cloud.expired')}</Text>}
    <View style={styles.transcriptionOptions}><TranscriptionLanguageOptions language={language} busy={busy} selectLanguage={setLanguage} /></View>
    <Text style={[styles.capabilityDetail, styles.blockButton]}>{t('cloud.upload_notice')}</Text>
    <Button label={t('cloud.send')} onPress={transcribe} busy={busy} disabled={!account || account.remainingSeconds <= 0 || expired} style={styles.blockButton} />
    {message && <Text accessibilityLiveRegion="polite" style={[styles.capabilityDetail, styles.blockButton]}>{message}</Text>}
    {!account && <Button label={t('cloud.open_settings')} onPress={openSettings} variant="secondary" style={styles.blockButton} />}
    <Button label={t('common.cancel')} onPress={() => { discardTemporaryAudio(audio); cancel() }} disabled={busy} variant="secondary" style={styles.blockButton} />
  </View>
}
