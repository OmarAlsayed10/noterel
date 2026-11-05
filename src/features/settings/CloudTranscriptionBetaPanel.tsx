import { useCallback, useEffect, useState } from 'react'
import { Alert, Text, TextInput, View } from 'react-native'
import { Button } from '../../components/ui'
import { errorText, t, tf } from '../../i18n'
import { activateCloudBeta, cloudAccess, cloudAccount, configureCloudEndpoint, resetCloudAccess } from '../../transcription/cloud/account'
import type { CloudAccount } from '../../transcription/cloud/protocol'
import { palette, styles } from '../../theme/styles'

export function CloudTranscriptionBetaPanel() {
  const [endpoint, setEndpoint] = useState('')
  const [code, setCode] = useState('')
  const [active, setActive] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [account, setAccount] = useState<CloudAccount | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    const access = await cloudAccess()
    setEndpoint(access?.endpoint ?? '')
    setActive(Boolean(access?.token))
    if (access?.activation) setCode(access.activation.code)
    if (access?.token) setAccount(await cloudAccount())
  }, [])
  useEffect(() => { void Promise.resolve().then(refresh).catch(error => setMessage(errorText(error, 'cloud.request_failed'))) }, [refresh])
  const activate = () => {
    setBusy(true)
    setMessage(null)
    void configureCloudEndpoint(endpoint).then(() => activateCloudBeta(code)).then(() => { setCode(''); setRecovering(false); return refresh() }).catch(error => setMessage(errorText(error, 'cloud.request_failed'))).finally(() => setBusy(false))
  }
  const reset = () => Alert.alert(t('cloud.reset_connection'), t('cloud.reset_notice'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('cloud.reset_connection'), style: 'destructive', onPress: () => {
      setBusy(true)
      void resetCloudAccess().then(() => { setRecovering(false); setCode(''); setAccount(null); return refresh() }).catch(error => setMessage(errorText(error, 'cloud.request_failed'))).finally(() => setBusy(false))
    } }
  ])
  return <View style={styles.settingsCard}>
    <Text style={styles.panelTitle}>{t('cloud.title')}</Text>
    <Text style={styles.capabilityDetail}>{t('cloud.beta_description')}</Text>
    {active && !recovering ? <>
      {account && <Text accessibilityLiveRegion="polite" style={styles.notice}>{tf('cloud.balance', { minutes: Math.floor(account.remainingSeconds / 60), reserved: Math.ceil(account.reservedSeconds / 60), expiry: account.expiresAt.slice(0, 10) })}</Text>}
      <Text selectable style={styles.capabilityDetail}>{endpoint}</Text>
      <Button label={t('cloud.refresh_balance')} variant="secondary" busy={busy} style={styles.blockButton} onPress={() => { setBusy(true); setMessage(null); void refresh().catch(error => setMessage(errorText(error, 'cloud.request_failed'))).finally(() => setBusy(false)) }} />
      <Button label={t('cloud.use_recovery_code')} variant="secondary" disabled={busy} style={styles.blockButton} onPress={() => { setRecovering(true); setCode(''); setMessage(t('cloud.recovery_notice')) }} />
    </> : <>
      <Text style={[styles.fieldLabel, styles.blockButton]}>{t('cloud.server_address')}</Text>
      <TextInput accessibilityLabel={t('cloud.server_address')} autoCapitalize="none" autoCorrect={false} editable={!busy && !active} keyboardType="url" onChangeText={setEndpoint} placeholder="https://…" placeholderTextColor={palette.placeholder} selectionColor={palette.link} style={[styles.input, styles.boxedInput]} value={endpoint} />
      {!endpoint && <Text style={styles.capabilityDetail}>{t('cloud.not_configured')}</Text>}
      <Text style={[styles.fieldLabel, styles.blockButton]}>{t('cloud.invitation_code')}</Text>
      <TextInput accessibilityLabel={t('cloud.invitation_code')} autoCapitalize="characters" autoCorrect={false} editable={!busy} maxLength={256} onChangeText={setCode} selectionColor={palette.link} style={[styles.input, styles.boxedInput]} value={code} />
      <Button label={t('cloud.activate')} busy={busy} disabled={!endpoint.trim() || !code.trim()} onPress={activate} style={styles.blockButton} />
      {recovering && <Button label={t('common.cancel')} variant="secondary" disabled={busy} onPress={() => setRecovering(false)} style={styles.blockButton} />}
    </>}
    {message && <Text accessibilityLiveRegion="polite" style={[styles.capabilityDetail, styles.blockButton]}>{message}</Text>}
    {endpoint && <Button label={t('cloud.reset_connection')} variant="secondary" disabled={busy} onPress={reset} style={styles.blockButton} />}
    <Text style={[styles.providerDisclaimer, styles.blockButton]}>{t('cloud.disclosure')}</Text>
  </View>
}
