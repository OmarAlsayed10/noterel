import type { ReactNode } from 'react'
import { ScrollView, Text } from 'react-native'
import { styles } from '../../theme/styles'

export function QuickCaptureLayout({ notice, children }: { readonly notice: string | null; readonly children: ReactNode }) {
  return <ScrollView style={styles.content} contentContainerStyle={styles.quickCapturePage} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
    {notice && <Text style={styles.quickCaptureNotice}>{notice}</Text>}
    {children}
  </ScrollView>
}
