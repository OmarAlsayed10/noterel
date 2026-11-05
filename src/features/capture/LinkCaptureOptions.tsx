import { Pressable, Text, TextInput, View } from 'react-native'
import { palette, styles } from '../../theme/styles'
import { captureCopy } from './captureCopy'

export function LinkCaptureOptions({ mode, choose, takeaway, changeTakeaway, disabled }: { readonly mode: 'reference' | 'extract'; readonly choose: (mode: 'reference' | 'extract') => void; readonly takeaway: string; readonly changeTakeaway: (text: string) => void; readonly disabled: boolean }) {
  return <View style={{ gap: 12 }}>
    <View style={[styles.captureKinds, { alignItems: 'stretch', flexDirection: 'column', flexWrap: 'nowrap' }]}>{(['reference', 'extract'] as const).map(option => <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: mode === option, disabled }} disabled={disabled} onPress={() => choose(option)} style={[styles.captureKind, mode === option && styles.captureKindSelected, { flex: 0, minWidth: 0, width: '100%' }]}><Text style={[styles.captureKindText, mode === option && styles.captureKindTextSelected]}>{captureCopy(option === 'reference' ? 'reference' : 'prepare')}</Text></Pressable>)}</View>
    <Text style={styles.capabilityDetail}>{captureCopy(mode === 'reference' ? 'referenceDetail' : 'prepareDetail')}</Text>
    <Text style={styles.fieldLabel}>{captureCopy('takeaway')}</Text>
    <TextInput accessibilityLabel={captureCopy('takeaway')} editable={!disabled} multiline maxLength={4096} value={takeaway} onChangeText={changeTakeaway} selectionColor={palette.link} style={[styles.input, styles.boxedInput, { minHeight: 80, writingDirection: 'auto' }]} textAlignVertical="top" />
  </View>
}
