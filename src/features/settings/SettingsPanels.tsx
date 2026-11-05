import { codexCredential, signOutMobileCodex, startMobileCodexLogin } from '../../ai/codexAuth'
import { copyCodexDeviceCode, dismissCodexDeviceCode, openCodexDeviceLogin } from '../../ai/codexDeviceCode'
import { automaticBackupSettings, availableDesktopBackups, deleteDesktopBackup, disableAutomaticBackup, enableAutomaticBackup, restoreDesktopBackup, syncAutomaticBackup } from '../../backup/desktopBackup'
import { exportPhoneNotes, importPhoneNotes, shareRecoveryKey } from '../../backup/notesBackup'
import { connectCompanion, pairCompanion, parsePairingCode } from '../../companion/client'
import { Button, ButtonRow, IconButton, SettingsCard } from '../../components/ui'
import { palette, styles } from '../../theme/styles'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Clipboard from 'expo-clipboard'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native'
import type { PairingQr } from '../../companion/protocol'
import type { ConnectionState } from '../../types'
import { t, tf, errorText } from '../../i18n'
import { ReadableExportPanel } from './ReadableExportPanel'

export function NotesBackupPanel({ changed }: { readonly changed: () => void }) {
  const [recoveryKey, setRecoveryKey] = useState('')
  const [restoreKey, setRestoreKey] = useState('')
  const [message, setMessage] = useState(t('settings.save_a_portable_encrypted_copy_when_you'))
  const [busy, setBusy] = useState(false)
  const exportNotes = () => {
    setBusy(true)
    void exportPhoneNotes().then(result => {
      setRecoveryKey(result.recoveryKey)
      setMessage(tf('settings.notes_exported', { count: result.count }))
    }).catch(error => setMessage(errorText(error, 'settings.notes_could_not_be_exported'))).finally(() => setBusy(false))
  }
  const importNotes = () => {
    if (!restoreKey.trim()) return
    setBusy(true)
    void importPhoneNotes(restoreKey).then(count => {
      if (count === null) return
      setMessage(tf('settings.notes_restored', { count }))
      setRestoreKey('')
      changed()
    }).catch(() => setMessage(t('settings.backup_or_recovery_key_is_invalid'))).finally(() => setBusy(false))
  }
  return <><SettingsCard eyebrow={t('settings.offline_recovery_eyebrow')} title={t('settings.portable_recovery_file')} description={message}>
    <ButtonRow><Button label={t('settings.export')} onPress={exportNotes} busy={busy} /><Button label={t('settings.restore_file')} onPress={importNotes} disabled={busy || !restoreKey.trim()} variant="secondary" /></ButtonRow>
    {recoveryKey && <View style={styles.recoveryKey}><Text style={styles.fieldLabel}>{t('settings.recovery_key_save_separately')}</Text><Text selectable style={styles.recoveryKeyText}>{recoveryKey}</Text></View>}
    <TextInput autoCapitalize="none" autoCorrect={false} editable={!busy} onChangeText={setRestoreKey} placeholder={t('settings.paste_a_backup_recovery_key')} placeholderTextColor={palette.placeholder} selectionColor={palette.link} style={[styles.input, styles.boxedInput]} value={restoreKey} />
  </SettingsCard><ReadableExportPanel /></>
}

const backupConnectionMessage = (connectionState: ConnectionState): string => connectionState === 'offline' ? t('settings.desktop_is_offline_backup_settings_remain_available') : connectionState === 'connected' ? t('settings.desktop_is_available_load_backups_only_when') : t('settings.desktop_backups_are_separate_from_synchronization_and')

export function DesktopBackupPanel({ changed, connectionState }: { readonly changed: () => void; readonly connectionState: ConnectionState }) {
  const [enabled, setEnabled] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [recoveryKeyExpiresAt, setRecoveryKeyExpiresAt] = useState<number | null>(null)
  const [recoveryKeySeconds, setRecoveryKeySeconds] = useState(0)
  const [restoreKey, setRestoreKey] = useState('')
  const [backups, setBackups] = useState<Awaited<ReturnType<typeof availableDesktopBackups>>>([])
  const [notice, setNotice] = useState<{ readonly state: ConnectionState; readonly text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const setMessage = (text: string) => setNotice({ state: connectionState, text })
  const message = notice?.state === connectionState ? notice.text : backupConnectionMessage(connectionState)
  const loadSettings = () => { void automaticBackupSettings().then(settings => setEnabled(settings.enabled)) }
  const loadBackups = () => {
    if (connectionState !== 'connected') {
      setMessage(t('settings.desktop_is_offline_use_check_again_under'))
      return
    }
    setBusy(true)
    void connectCompanion().then(async connection => {
      try {
        setBackups(await availableDesktopBackups(connection))
        setMessage(t('settings.available_desktop_backups_loaded'))
      } finally {
        connection.close()
      }
    }).catch(() => setMessage(t('settings.desktop_went_offline'))).finally(() => setBusy(false))
  }
  useEffect(loadSettings, [])
  useEffect(() => {
    if (recoveryKeyExpiresAt === null) return
    const updateCountdown = () => {
      const seconds = Math.max(0, Math.ceil((recoveryKeyExpiresAt - Date.now()) / 1000))
      setRecoveryKeySeconds(seconds)
      if (seconds === 0) {
        setRecoveryKey('')
        setRecoveryKeyExpiresAt(null)
      }
    }
    const timer = setInterval(updateCountdown, 250)
    return () => clearInterval(timer)
  }, [recoveryKeyExpiresAt])
  const enable = () => {
    setBusy(true)
    void enableAutomaticBackup().then(async key => {
      setEnabled(true)
      setRecoveryKey(key)
      setRecoveryKeyExpiresAt(Date.now() + 60_000)
      setRecoveryKeySeconds(60)
      try {
        const connection = await connectCompanion()
        try {
          const count = await syncAutomaticBackup(connection, t('common.android_phone'))
          setMessage(tf('settings.notes_backed_up', { count: count ?? 0 }))
        } finally {
          connection.close()
        }
      } catch {
        setMessage(t('settings.automatic_backup_is_enabled_and_will_run'))
      }
    }).catch(error => setMessage(errorText(error, 'settings.desktop_backup_could_not_be_enabled'))).finally(() => setBusy(false))
  }
  const copyRecoveryKey = () => {
    void Clipboard.setStringAsync(recoveryKey).then(() => setMessage(t('settings.recovery_key_copied'))).catch(() => setMessage(t('settings.recovery_key_could_not_be_copied')))
  }
  const saveRecoveryKey = () => {
    setMessage(t('settings.recovery_key_file_ready'))
    void shareRecoveryKey(recoveryKey).catch(() => setMessage(t('settings.recovery_key_file_could_not_be_saved')))
  }
  const disable = () => {
    setBusy(true)
    void disableAutomaticBackup().then(() => { setEnabled(false); setMessage(t('settings.automatic_desktop_backup_is_off_existing_backups')) }).finally(() => setBusy(false))
  }
  const remove = (backupId: string) => Alert.alert(t('settings.delete_this_backup'), t('settings.this_permanently_removes_the_encrypted_backup_from'), [
    { text: t('common.keep'), style: 'cancel' },
    { text: t('settings.delete_backup'), style: 'destructive', onPress: () => {
      void connectCompanion().then(async connection => {
        try {
          await deleteDesktopBackup(connection, backupId)
        } finally {
          connection.close()
        }
        setMessage(t('settings.desktop_backup_deleted'))
        loadBackups()
      }).catch(() => setMessage(t('settings.the_desktop_backup_could_not_be_deleted')))
    } }
  ])
  const restore = (backupId: string) => {
    if (!restoreKey.trim()) return
    setBusy(true)
    void connectCompanion().then(async connection => {
      try {
        const count = await restoreDesktopBackup(connection, backupId, restoreKey)
        setMessage(tf('settings.notes_restored', { count }))
        changed()
      } finally {
        connection.close()
      }
    }).catch(() => setMessage(t('settings.the_backup_or_recovery_key_is_invalid'))).finally(() => setBusy(false))
  }
  return <SettingsCard eyebrow={t('settings.desktop_recovery_eyebrow')} title={t('settings.automatic_encrypted_backup')} description={message}>
    <ButtonRow><Button accessibilityRole="switch" label={enabled ? t('settings.turn_off_automatic_backup') : t('settings.enable_automatic_backup')} onPress={enabled ? disable : enable} busy={busy} />{connectionState === 'connected' && <Button label={t('settings.show_available_desktop_backups')} onPress={loadBackups} disabled={busy} variant="secondary" />}</ButtonRow>
    {recoveryKey && recoveryKeySeconds > 0 && <View style={styles.recoveryKey}><View style={styles.recoveryKeyHeading}><Text style={styles.recoveryKeyLabel}>{t('settings.recovery_key_save_separately')} · {tf('settings.recovery_key_visible_for', { count: recoveryKeySeconds })}</Text><View style={styles.recoveryKeyActions}><IconButton accessibilityLabel={t('settings.copy_recovery_key')} icon="⧉" onPress={copyRecoveryKey} /><IconButton accessibilityLabel={t('settings.save_recovery_key')} icon="⇩" onPress={saveRecoveryKey} /></View></View><Text selectable style={styles.recoveryKeyText}>{recoveryKey}</Text></View>}
    {backups.length > 0 && <><Text style={styles.fieldLabel}>{t('settings.available_desktop_backups')}</Text><TextInput autoCapitalize="none" autoCorrect={false} onChangeText={setRestoreKey} placeholder={t('settings.paste_recovery_key_to_restore')} placeholderTextColor={palette.placeholder} style={[styles.input, styles.boxedInput]} value={restoreKey} />{backups.map(backup => <View key={backup.backupId} style={styles.backupRow}><View style={styles.libraryCardCopy}><Text style={styles.capabilityName}>{backup.displayName}</Text><Text style={styles.capabilityDetail}>{backup.noteCount} notes · {new Date(backup.updatedAt).toLocaleString()}</Text></View><View style={styles.libraryCardActions}><Pressable accessibilityRole="button" disabled={busy || !restoreKey.trim()} onPress={() => restore(backup.backupId)} style={styles.libraryEditButton}><Text style={styles.libraryEditText}>{t('common.restore')}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => remove(backup.backupId)} style={styles.libraryDeleteButton}><Text style={styles.libraryDeleteText}>{t('common.delete')}</Text></Pressable></View></View>)}</>}
  </SettingsCard>
}

export function PairingPanel({ state, changed, checkDesktop }: { readonly state: ConnectionState; readonly changed: (state: Exclude<ConnectionState, 'loading'>) => void; readonly checkDesktop: () => void }) {
  const [permission, requestPermission] = useCameraPermissions()
  const [scanning, setScanning] = useState(false)
  const [pairing, setPairing] = useState<PairingQr | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [channel, setChannel] = useState<{ readonly state: 'checking' | 'ready' | 'failed'; readonly detail: string } | null>(null)
  const checkChannel = (qr: PairingQr) => {
    setChannel({ state: 'checking', detail: t('settings.checking_the_secure_channel') })
    const endpoint = new URL('/v1/connect', qr.relayUrl)
    endpoint.protocol = 'wss:'
    void import('../../../modules/kestrel-source-processing').then(({ default: native }) => native.probeWebSocket(endpoint.toString())).then(result => {
      setChannel(result.state === 'open' ? { state: 'ready', detail: t('settings.secure_channel_reachable') } : { state: 'failed', detail: `${t('settings.secure_channel_unreachable')}: ${result.detail}${result.status ? ` (HTTP ${result.status})` : ''}` })
    }).catch(error => setChannel({ state: 'failed', detail: errorText(error, 'settings.secure_channel_check_failed') }))
  }
  const scan = () => {
    if (!permission?.granted) {
      void requestPermission().then(result => {
        setScanning(result.granted)
        if (!result.granted) setMessage(t('settings.camera_permission_is_required_to_scan_a'))
      })
      return
    }
    setScanning(true)
  }
  const pair = () => {
    if (!pairing || busy) return
    setBusy(true)
    setMessage(null)
    void pairCompanion(pairing, t('common.android_phone')).then(() => {
      setPairing(null)
      setChannel(null)
      setMessage(null)
      changed('paired')
    }).catch(error => setMessage(error instanceof Error ? `${t('settings.pairing_failed')}: ${error.message}` : t('settings.pairing_failed_with_an_unknown_error'))).finally(() => setBusy(false))
  }
  return <SettingsCard eyebrow={t('settings.companion_eyebrow')} title={state === 'connected' ? t('settings.desktop_connected') : state === 'offline' ? t('settings.desktop_offline') : state === 'paired' ? t('settings.checking_desktop') : state === 'loading' ? t('settings.checking_pairing') : t('settings.pair_this_phone')}>
    {state === 'expired' && <Text style={styles.failureText}>{t('settings.the_device_ticket_expired_pair_again_from')}</Text>}
    {state === 'invalid' && <Text style={styles.failureText}>{t('settings.stored_pairing_data_is_invalid_pairing_recovery')}</Text>}
    {message && (state === 'unpaired' || state === 'expired' || state === 'invalid' || pairing !== null) && <Text style={styles.capabilityDetail}>{message}</Text>}
    {scanning && !pairing && <CameraView barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={result => {
      try {
        const parsed = parsePairingCode(result.data)
        setPairing(parsed)
        setScanning(false)
        setMessage(null)
        checkChannel(parsed)
      } catch {
        setScanning(false)
        setMessage(t('settings.that_is_not_a_valid_current_kestrel'))
      }
    }} style={styles.camera} />}
    {pairing && channel && <View style={styles.channelStatus}>{(channel.state === 'checking' || busy) && <ActivityIndicator color={palette.ink} size="small" />}<Text style={[styles.capabilityDetail, channel.state === 'failed' && styles.failureText]}>{busy ? t('settings.pairing_with_desktop') : channel.detail}</Text></View>}
    {pairing
      ? <ButtonRow><Button label={t('common.cancel')} onPress={() => { setPairing(null); setChannel(null) }} disabled={busy} variant="secondary" /><Button label={busy ? t('settings.pairing') : channel?.state === 'failed' ? t('settings.try_anyway') : t('settings.trust_and_pair')} onPress={pair} busy={busy} disabled={channel?.state === 'checking'} /></ButtonRow>
      : scanning
        ? <Button label={t('settings.cancel_scanning')} onPress={() => setScanning(false)} variant="secondary" />
        : state === 'paired' || state === 'connected' || state === 'offline'
          ? <>
            <View style={styles.pairedSummary}><View style={[styles.pairedSignal, state !== 'connected' && styles.pairedSignalOffline]} /><Text style={styles.pairedText}>{state === 'connected' ? t('settings.desktop_is_online') : state === 'offline' ? t('common.desktop_is_offline') : t('settings.checking_desktop_2')}</Text>{state === 'paired' && <ActivityIndicator color={palette.ink} size="small" />}</View>
            <ButtonRow>{state === 'offline' && <Button label={t('settings.check_again')} onPress={checkDesktop} />}<Button label={t('settings.change_desktop')} onPress={scan} variant="secondary" style={styles.changeDesktopButton} /></ButtonRow>
          </>
          : <Button label={t('settings.scan_desktop_code')} onPress={scan} />}
  </SettingsCard>
}

export function CodexSettingsPanel() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [deviceCode, setDeviceCode] = useState<{ code: string; url: string } | null>(null)
  const [message, setMessage] = useState(t('settings.checking_codex_sign_in'))
  const [busy, setBusy] = useState(false)
  const loginController = useRef<AbortController | null>(null)
  const refresh = useCallback(() => {
    void codexCredential().then(credential => {
      setSignedIn(credential !== null)
      setMessage(credential ? t('settings.codex_is_available_for_mobile_ask') : t('settings.codex_credentials_are_stored_only_on_this'))
    }).catch(error => {
      setSignedIn(false)
      setMessage(errorText(error, 'settings.codex_sign_in_status_is_unavailable'))
    })
  }, [])
  const clearDeviceCodeNotification = () => { void dismissCodexDeviceCode().catch(error => console.warn(t('settings.could_not_dismiss_codex_notification'), error)) }
  useEffect(refresh, [refresh])
  useEffect(() => () => { loginController.current?.abort(); clearDeviceCodeNotification() }, [])
  const beginLogin = () => {
    if (busy) return
    const controller = new AbortController()
    loginController.current = controller
    setBusy(true)
    setDeviceCode(null)
    setMessage(t('settings.requesting_a_device_code_from_openai'))
    void startMobileCodexLogin(controller.signal).then(login => {
      setDeviceCode({ code: login.userCode, url: login.verificationUri })
      setMessage(t('settings.open_openai_enter_this_code_and_finish'))
      return login.complete()
    }).then(() => {
      setSignedIn(true)
      setDeviceCode(null)
      setMessage(t('settings.codex_sign_in_completed_on_this_phone'))
    }).catch(error => {
      if (!controller.signal.aborted) setMessage(errorText(error, 'settings.codex_sign_in_failed'))
    }).finally(() => {
      clearDeviceCodeNotification()
      if (loginController.current === controller) loginController.current = null
      setBusy(false)
    })
  }
  const cancelLogin = () => {
    loginController.current?.abort()
    loginController.current = null
    setBusy(false)
    setDeviceCode(null)
    clearDeviceCodeNotification()
    setMessage(t('settings.codex_sign_in_cancelled'))
  }
  const signOut = () => Alert.alert(t('settings.sign_out_of_codex_on_this_phone'), t('settings.this_removes_the_mobile_access_and_refresh'), [
    { text: t('settings.keep_signed_in'), style: 'cancel' },
    { text: t('settings.sign_out'), style: 'destructive', onPress: () => { void signOutMobileCodex().then(() => { setSignedIn(false); setMessage(t('settings.codex_credentials_were_removed_from_this_phone')) }).catch(() => setMessage(t('settings.codex_credentials_could_not_be_removed'))) } }
  ])
  return <SettingsCard eyebrow={t('settings.experimental_provider_eyebrow')} title={t('settings.codex_on_this_phone')} description={message}>
    {deviceCode && <View style={styles.deviceCodeBox}><Text style={styles.deviceCodeLabel}>{t('settings.device_code')}</Text><Text selectable style={styles.deviceCode}>{deviceCode.code}</Text><ButtonRow><IconButton accessibilityLabel={t('settings.copy_code')} icon="⧉" onPress={() => void copyCodexDeviceCode(deviceCode.code).then(() => setMessage(t('settings.device_code_copied'))).catch(() => setMessage(t('settings.the_device_code_could_not_be_copied')))} /><Button accessibilityRole="link" label={t('settings.open_openai')} onPress={() => void openCodexDeviceLogin(deviceCode.code, deviceCode.url).then(notificationVisible => setMessage(notificationVisible ? t('settings.open_the_notification_shade_to_keep_the') : t('settings.code_copied_notifications_are_off_so_switch'))).catch(() => setMessage(t('settings.openai_sign_in_could_not_be_opened')))} /></ButtonRow></View>}
    {!deviceCode && signedIn === false && <Button label={busy ? t('settings.starting') : t('settings.sign_in_to_codex')} onPress={beginLogin} busy={busy} />}
    {deviceCode && <Button label={t('settings.cancel_sign_in')} onPress={cancelLogin} variant="secondary" />}
    {signedIn && <Button label={t('settings.sign_out_on_this_phone')} onPress={signOut} variant="secondary" />}
    <Text style={styles.providerDisclaimer}>{t('settings.uses_openais_codex_device_flow_account_access')}</Text>
  </SettingsCard>
}
