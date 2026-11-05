import { Pressable, Text, View } from 'react-native'
import { t } from '../../i18n'
import type { TranscriptionLanguage } from '../../transcription/transcription'
import { styles } from '../../theme/styles'

export function TranscriptionLanguageOptions({ language, busy, selectLanguage }: { readonly language: TranscriptionLanguage; readonly busy: boolean; readonly selectLanguage: (language: TranscriptionLanguage) => void }) {
  return (
    <View style={styles.transcriptionOptionGroup}>
      <Text style={[styles.fieldLabel, styles.transcriptionOptionLabel]}>{t('transcription.spoken_language')}</Text>
      <View style={styles.captureKinds}>{(['auto', 'ar', 'en'] as const).map(option => <Pressable
        key={option}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy, selected: language === option }}
        disabled={busy}
        onPress={() => selectLanguage(option)}
        style={[styles.captureKind, language === option && styles.captureKindSelected]}>
        <Text style={[styles.captureKindText, language === option && styles.captureKindTextSelected]}>{option === 'auto' ? t('transcription.detect_language') : option === 'ar' ? t('settings.arabic') : t('settings.english')}</Text>
      </Pressable>)}</View>
    </View>
  )
}
