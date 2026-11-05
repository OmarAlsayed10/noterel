import { useState } from 'react'
import { ActivityIndicator, Modal, Text, View } from 'react-native'
import { checkForUpdate, type AvailableUpdate } from '../../updates/appUpdates'
import { Button, SettingsCard } from '../../components/ui'
import { errorText, t, tf } from '../../i18n'
import { palette, styles } from '../../theme/styles'

export function UpdateProgressModal({ visible, progress }: { readonly visible: boolean; readonly progress: number }) {
  return <Modal animationType="fade" onRequestClose={() => undefined} statusBarTranslucent transparent visible={visible}>
    <View style={styles.updateModalBackdrop}><View accessibilityRole="alert" accessibilityViewIsModal style={styles.updateModalCard}>
      <ActivityIndicator color={palette.link} size="large" />
      <Text style={styles.updateModalTitle}>{progress > 0 ? tf('settings.update_download_progress', { percent: progress }) : t('settings.preparing_update')}</Text>
      <Text style={styles.updateModalDetail}>{t('settings.update_download_notice')}</Text>
    </View></View>
  </Modal>
}

export function UpdatePanel({ availableUpdate, checkingFinished, install, installing }: { readonly availableUpdate: AvailableUpdate | null; readonly checkingFinished: (update: AvailableUpdate | null) => void; readonly install: () => void; readonly installing: boolean }) {
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState(t('settings.updates_description'))
  const check = () => {
    setChecking(true)
    void checkForUpdate().then(update => {
      checkingFinished(update)
      setMessage(update ? tf('app.update_banner', { version: update.versionName }) : t('settings.you_have_the_latest_version'))
    }).catch(error => setMessage(errorText(error, 'settings.update_check_failed'))).finally(() => setChecking(false))
  }
  return <SettingsCard eyebrow={t('settings.updates_eyebrow')} title={t('settings.app_updates')} description={availableUpdate ? tf('app.update_banner', { version: availableUpdate.versionName }) : message}>
    <Button label={availableUpdate ? t('settings.download_and_install') : t('settings.check_for_updates')} onPress={availableUpdate ? install : check} busy={checking || installing} />
  </SettingsCard>
}
