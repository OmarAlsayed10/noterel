import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { Button, SettingsCard } from '../../components/ui'
import { errorText, t } from '../../i18n'
import { deleteTranslationModel, downloadTranslationModel, installedTranslationModels, translationLanguageLabel, translationLanguages, translationModelDownloadStates, type TranslationLanguageCode } from '../../translation/translation'
import { palette, styles } from '../../theme/styles'
import { showToast } from '../../toast'

export function TranslationPacksPanel() {
  const [installed, setInstalled] = useState<readonly TranslationLanguageCode[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<TranslationLanguageCode | null>(null)
  const [downloads, setDownloads] = useState<Partial<Record<TranslationLanguageCode, 'idle' | 'queued' | 'downloading' | 'succeeded' | 'failed' | 'cancelled'>>>({})
  const refreshErrorShown = useRef(false)
  const refresh = useCallback(() => {
    void Promise.all([installedTranslationModels(), translationModelDownloadStates()]).then(([models, states]) => {
      setInstalled(models)
      const nextDownloads = Object.fromEntries(states.map(state => [state.language, state.state])) as Partial<Record<TranslationLanguageCode, 'idle' | 'queued' | 'downloading' | 'succeeded' | 'failed' | 'cancelled'>>
      setDownloads(nextDownloads)
      setBusy(current => current && (nextDownloads[current] === 'queued' || nextDownloads[current] === 'downloading') ? current : null)
      refreshErrorShown.current = false
    }).catch(error => {
      setBusy(null)
      if (!refreshErrorShown.current) showToast(errorText(error, 'translation.packs_unavailable'))
      refreshErrorShown.current = true
    })
  }, [])
  useEffect(() => {
    refresh()
    if (!open) return
    const interval = setInterval(refresh, 1500)
    return () => clearInterval(interval)
  }, [open, refresh])
  const download = (language: TranslationLanguageCode) => {
    setBusy(language)
    void downloadTranslationModel(language).then(refresh).catch(error => {
      showToast(errorText(error, 'translation.download_failed'))
      setBusy(null)
    })
  }
  const remove = (language: TranslationLanguageCode) => Alert.alert(t('translation.remove_pack_title'), translationLanguageLabel(language), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('common.remove'), style: 'destructive', onPress: () => {
      setBusy(language)
      void deleteTranslationModel(language).then(() => {
        showToast(t('translation.pack_removed'))
        refresh()
      }).catch(error => showToast(errorText(error, 'translation.remove_failed'))).finally(() => setBusy(null))
    } }
  ])
  const requestLanguage = () => {
    const subject = encodeURIComponent(t('translation.request_email_subject'))
    const body = encodeURIComponent(t('translation.request_email_body'))
    void Linking.openURL(`mailto:?subject=${subject}&body=${body}`).catch(() => showToast(t('translation.email_unavailable')))
  }
  const available = translationLanguages().filter(language => !installed.includes(language.code))
  const activeDownload = available.find(language => downloads[language.code] === 'queued' || downloads[language.code] === 'downloading')?.code ?? null
  return <SettingsCard eyebrow={t('translation.settings_eyebrow')} title={t('translation.language_packs')} description={t('translation.settings_description')}>
    {installed.length === 0 ? <Text style={styles.capabilityDetail}>{t('translation.no_packs_installed')}</Text> : installed.map(language => <View key={language} style={styles.translationPackRow}><View style={styles.libraryCardCopy}><Text style={styles.capabilityName}>{translationLanguageLabel(language)}</Text><Text style={styles.capabilityDetail}>{language === 'en' ? t('translation.always_available') : t('translation.installed')}</Text></View>{language !== 'en' && <Button label={t('common.remove')} onPress={() => remove(language)} busy={busy === language} disabled={busy !== null} variant="secondary" style={styles.translationPackButton} />}</View>)}
    <Button label={t('translation.manage_packs')} onPress={() => setOpen(true)} disabled={busy !== null} style={styles.blockButton} />
    <Text style={styles.providerDisclaimer}>{t('translation.google_model_disclosure')}</Text>
    <Modal animationType="fade" onRequestClose={() => setOpen(false)} transparent visible={open}>
      <View style={styles.translationModalBackdrop}><View accessibilityViewIsModal style={styles.translationModalSheet}>
        <View style={styles.translationModalHeading}><View style={styles.libraryCardCopy}><Text style={styles.eyebrow}>{t('translation.available_eyebrow')}</Text><Text style={styles.panelTitle}>{t('translation.download_a_pack')}</Text></View><Pressable accessibilityLabel={t('common.close')} accessibilityRole="button" onPress={() => setOpen(false)} style={styles.iconButton}><Text style={styles.iconButtonText}>×</Text></Pressable></View>
        <ScrollView contentContainerStyle={styles.translationModalList}>{available.length === 0 ? <Text style={styles.capabilityDetail}>{t('translation.all_packs_installed')}</Text> : available.map(language => { const state = downloads[language.code]; const active = state === 'queued' || state === 'downloading'; return <View key={language.code} style={styles.translationPackRow}><View style={styles.libraryCardCopy}><Text style={styles.capabilityName}>{language.label}</Text>{active && <View accessibilityRole="progressbar" accessibilityValue={{ text: t('translation.downloading') }} style={styles.translationDownloadState}><ActivityIndicator color={palette.link} size="small" /><Text accessibilityLiveRegion="polite" style={styles.capabilityDetail}>{state === 'queued' ? t('transcription.waiting_for_connection') : t('translation.downloading')}</Text></View>}{state === 'failed' && <Text style={styles.cacheStateFailed}>{t('translation.download_failed')}</Text>}</View><Button label={active ? t('translation.downloading_short') : state === 'failed' || state === 'cancelled' ? t('transcription.resume') : t('translation.download')} onPress={() => download(language.code)} busy={busy === language.code} disabled={busy !== null || activeDownload !== null} style={styles.translationPackButton} /></View> })}<Button label={t('translation.request_language')} onPress={requestLanguage} variant="secondary" style={styles.blockButton} /></ScrollView>
      </View></View>
    </Modal>
  </SettingsCard>
}
