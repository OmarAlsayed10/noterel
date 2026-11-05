import { useEffect, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { Button } from '../../components/ui'
import { errorText, t, tf } from '../../i18n'
import { appDisplayName } from '../../edition'
import { discardTemporaryAudio, installedTranscriptionModels, startAudioTranscription, transcriptionModels, type AudioCandidate, type TranscriptionLanguage, type TranscriptionModel } from '../../transcription/transcription'
import { styles } from '../../theme/styles'
import { transcriptionMediaKind } from '../../transcription/media'
import { videoRecoveryCopy } from './videoRecoveryCopy'
import { TranscriptionOptions } from './TranscriptionOptions'
import { VideoSourcePreview } from './VideoSourcePreview'

export function AudioTranscriptionPanel({ audio, cancel, openSettings, started, compact, active = true, busyChanged }: { readonly audio: AudioCandidate; readonly cancel: () => void; readonly openSettings: () => void; readonly started: () => void; readonly compact: boolean; readonly active?: boolean; readonly busyChanged?: (busy: boolean) => void }) {
  const [installed, setInstalled] = useState<readonly TranscriptionModel[] | null>(null)
  const [model, setModel] = useState<TranscriptionModel>('small')
  const [language, setLanguage] = useState<TranscriptionLanguage>('auto')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => { busyChanged?.(busy) }, [busy, busyChanged])
  useEffect(() => {
    if (!active) return
    let current = true
    void installedTranscriptionModels().then(models => {
      if (!current) return
      setInstalled(models)
      setModel(selected => models.includes(selected) ? selected : models[0] ?? 'small')
    }).catch(error => {
      if (!current) return
      setInstalled([])
      setMessage(errorText(error, 'transcription.models_unavailable'))
    })
    return () => { current = false }
  }, [active])
  const selectModel = (selected: TranscriptionModel) => {
    if (installed?.includes(selected)) {
      setModel(selected)
      return
    }
    const details = transcriptionModels.find(option => option.id === selected)!
    Alert.alert(t('transcription.download_model'), tf('transcription.model_required', { model: details.name, size: details.downloadSize }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('translation.open_settings'), onPress: openSettings }
    ])
  }
  const close = () => {
    discardTemporaryAudio(audio)
    cancel()
  }
  const transcribe = () => {
    if (!installed?.includes(model)) return
    setBusy(true)
    void installedTranscriptionModels().then(async models => {
      setInstalled(models)
      if (!models.includes(model)) {
        setMessage(t('transcription.install_model_first'))
        return
      }
      await startAudioTranscription(audio, model, language)
      discardTemporaryAudio(audio)
      started()
    }).catch(error => setMessage(errorText(error, 'transcription.transcription_failed'))).finally(() => setBusy(false))
  }
  const container = compact ? styles.quickCaptureCard : styles.panel
  const video = Boolean(audio.origin) || transcriptionMediaKind(audio.mediaType, audio.filename) === 'video'
  return <View style={container}>
    <Text style={styles.eyebrow}>{video ? videoRecoveryCopy('videoEyebrow') : t('transcription.audio_eyebrow')}</Text>
    <Text numberOfLines={2} style={compact ? styles.quickCaptureTitle : styles.panelTitle}>{audio.filename}</Text>
    <Text style={styles.capabilityDetail}>{video ? videoRecoveryCopy('videoPrivacy') : tf('transcription.audio_not_retained', { app: appDisplayName })}</Text>
    {audio.origin && <VideoSourcePreview source={audio.origin} />}
    <TranscriptionOptions installed={installed ?? []} model={model} language={language} busy={busy || installed === null} selectModel={selectModel} selectLanguage={setLanguage} />
    {installed?.length === 0 && <Text style={[styles.staleNotice, styles.blockButton]}>{t('transcription.install_model_first')}</Text>}
    <Button label={t('transcription.transcribe_in_background')} onPress={transcribe} busy={busy} disabled={!installed?.includes(model)} style={styles.blockButton} />
    {message && <Text accessibilityLiveRegion="polite" style={styles.capabilityDetail}>{message}</Text>}
    <Button label={t('common.cancel')} onPress={close} disabled={busy} variant="secondary" style={styles.blockButton} />
  </View>
}

export { AudioTranscriptionJobsPanel } from './AudioTranscriptionJobsPanel'
export { AudioTranscriptReviewPanel } from './AudioTranscriptReviewPanel'
