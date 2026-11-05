import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { t } from '../../i18n'
import { styles } from '../../theme/styles'
import { NoteSummaryPanel } from './NoteSummaryPanel'
import type { ReadingMemory } from './types'

export function ReaderSummaryDialog({ reading, visible, close, openSettings, saved }: { readonly reading: ReadingMemory; readonly visible: boolean; readonly close: () => void; readonly openSettings: () => void; readonly saved: () => void }) {
  return <Modal animationType="fade" onRequestClose={close} transparent visible={visible}>
    <View style={styles.translationModalBackdrop}><View accessibilityViewIsModal style={styles.translationModalSheet}>
      <View style={styles.translationModalHeading}><Text style={styles.panelTitle}>{t('summary.title')}</Text><Pressable accessibilityLabel={t('common.close')} accessibilityRole="button" onPress={close} style={styles.iconButton}><Text style={styles.iconButtonText}>×</Text></Pressable></View>
      <ScrollView><NoteSummaryPanel reading={reading} openSettings={openSettings} saved={saved} /></ScrollView>
    </View></View>
  </Modal>
}
