import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { t } from '../../i18n'
import { styles } from '../../theme/styles'
import { AudioTranscriptionPanel } from './AudioTranscriptionPanel'
import { CloudTranscriptionPanel, type TranscriptionCaptureProps } from './CloudTranscriptionPanel'

export function TranscriptionCapturePanel(props: TranscriptionCaptureProps) {
  const [engine, setEngine] = useState<'phone' | 'cloud'>('phone')
  const [busy, setBusy] = useState(false)
  return <View style={styles.transcriptionOptions}>
    <View style={styles.captureKinds}>{(['phone', 'cloud'] as const).map(option => <Pressable accessibilityRole="button" accessibilityState={{ selected: engine === option, disabled: busy }} disabled={busy} key={option} onPress={() => setEngine(option)} style={[styles.captureKind, engine === option && styles.captureKindSelected]}>
      <Text style={[styles.captureKindText, engine === option && styles.captureKindTextSelected]}>{t(option === 'phone' ? 'cloud.on_phone' : 'cloud.choice')}</Text>
    </Pressable>)}</View>
    {engine === 'cloud' ? <CloudTranscriptionPanel {...props} busyChanged={setBusy} /> : <AudioTranscriptionPanel {...props} busyChanged={setBusy} />}
  </View>
}
