import { Pressable, Text, View } from 'react-native'
import { t } from '../../i18n'
import { styles } from '../../theme/styles'
import type { LibraryScope } from './types'

export function LibraryScopeSelector({ selected, choose }: { readonly selected: LibraryScope; readonly choose: (scope: LibraryScope) => void }) {
  return <View accessibilityRole="tablist" style={[styles.scopeRow, styles.captureKinds]}>{(['all', 'phone', 'desktop'] as const).map(option => <Pressable accessibilityRole="tab" accessibilityState={{ selected: selected === option }} key={option} onPress={() => choose(option)} style={[styles.captureKind, selected === option && styles.captureKindSelected]}><Text style={[styles.captureKindText, selected === option && styles.captureKindTextSelected]}>{t(option === 'all' ? 'library.scope_all' : option === 'phone' ? 'library.scope_phone' : 'library.scope_desktop')}</Text></Pressable>)}</View>
}
