import { useCallback, useEffect, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { Button, SettingsCard } from '../../components/ui'
import { errorText, t, tf } from '../../i18n'
import { cancelTranscriptionModelDownload, deleteTranscriptionModel, downloadTranscriptionModel, installedTranscriptionModels, transcriptionModelDownloadState, transcriptionModels, type TranscriptionModel, type TranscriptionModelDownload } from '../../transcription/transcription'
import { styles } from '../../theme/styles'
import { appDisplayName } from '../../edition'

const idleDownload: TranscriptionModelDownload = { state: 'idle', downloadedBytes: 0, totalBytes: 1 }

export function TranscriptionModelsPanel() {
  const [installed, setInstalled] = useState<readonly TranscriptionModel[]>([])
  const [downloads, setDownloads] = useState<Record<TranscriptionModel, TranscriptionModelDownload>>({ small: idleDownload, medium: idleDownload })
  const [removing, setRemoving] = useState<TranscriptionModel | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const refresh = useCallback(() => {
    void Promise.all([installedTranscriptionModels(), ...transcriptionModels.map(model => transcriptionModelDownloadState(model.id))]).then(([models, small, medium]) => {
      setInstalled(models)
      setDownloads({ small, medium })
      const failed = [small, medium].find(download => download.state === 'failed')
      if (failed) setMessage(failed.error ? errorText(new Error(failed.error), 'transcription.download_failed') : t('transcription.download_failed'))
    }).catch(error => setMessage(errorText(error, 'transcription.models_unavailable')))
  }, [])
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 1000)
    return () => clearInterval(timer)
  }, [refresh])
  const download = (model: TranscriptionModel) => {
    const details = transcriptionModels.find(candidate => candidate.id === model)!
    Alert.alert(t('transcription.download_model'), tf('transcription.download_confirmation', { app: appDisplayName, model: details.name, size: details.downloadSize }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('translation.download'), onPress: () => {
        setMessage(tf('transcription.download_continues_in_background', { app: appDisplayName }))
        void downloadTranscriptionModel(model).then(refresh).catch(error => setMessage(errorText(error, 'transcription.download_failed')))
      } }
    ])
  }
  const cancelDownload = (model: TranscriptionModel) => {
    void cancelTranscriptionModelDownload(model).then(() => {
      setMessage(t('transcription.download_cancelled'))
      refresh()
    }).catch(error => setMessage(errorText(error, 'transcription.cancel_failed')))
  }
  const remove = (model: TranscriptionModel) => {
    setRemoving(model)
    void deleteTranscriptionModel(model).then(deletedBytes => {
      setMessage(tf('transcription.model_removed', { size: Math.round(deletedBytes / 1024 / 1024) }))
      refresh()
    }).catch(error => setMessage(errorText(error, 'transcription.remove_failed'))).finally(() => setRemoving(null))
  }
  const activeModel = transcriptionModels.find(model => ['queued', 'downloading'].includes(downloads[model.id].state))?.id ?? null
  return <SettingsCard eyebrow={t('transcription.settings_eyebrow')} title={t('transcription.models_title')} description={tf('transcription.models_description_scoped', { app: appDisplayName })}>
    {transcriptionModels.map(model => {
      const ready = installed.includes(model.id)
      const downloadState = downloads[model.id]
      const active = downloadState.state === 'queued' || downloadState.state === 'downloading'
      const percent = downloadState.totalBytes > 0 ? Math.min(100, Math.round(downloadState.downloadedBytes * 100 / downloadState.totalBytes)) : 0
      const remainingMb = Math.max(0, Math.ceil((downloadState.totalBytes - downloadState.downloadedBytes) / (1024 * 1024)))
      return <View key={model.id} style={styles.translationPackRow}><View style={styles.libraryCardCopy}><Text style={styles.capabilityName}>{model.name} · {model.downloadSize}</Text><Text style={styles.capabilityDetail}>{model.id === 'small' ? t('transcription.small_detail') : t('transcription.medium_detail')}</Text>{active && <><View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }} style={styles.downloadProgressTrack}><View style={[styles.downloadProgressFill, { width: `${percent}%` }]} /></View><Text accessibilityLiveRegion="polite" style={styles.capabilityDetail}>{downloadState.state === 'queued' ? t('transcription.waiting_for_connection') : tf('transcription.download_progress', { percent, remaining: remainingMb })}</Text></>}</View><Button label={ready ? t('common.remove') : active ? t('common.cancel') : downloadState.state === 'cancelled' || downloadState.state === 'failed' ? t('transcription.resume') : t('translation.download')} onPress={() => ready ? remove(model.id) : active ? cancelDownload(model.id) : download(model.id)} busy={removing === model.id} disabled={removing !== null || activeModel !== null && activeModel !== model.id} variant={active ? 'danger' : ready ? 'secondary' : 'primary'} style={styles.translationPackButton} /></View>
    })}
    {message && <Text accessibilityLiveRegion="polite" style={styles.capabilityDetail}>{message}</Text>}
    <Text style={styles.providerDisclaimer}>{t('transcription.model_disclosure')}</Text>
  </SettingsCard>
}
