import { Pressable, Text, View } from 'react-native'
import { t } from '../../i18n'
import { transcriptionModels, type TranscriptionLanguage, type TranscriptionModel } from '../../transcription/transcription'
import { TranscriptionLanguageOptions } from './TranscriptionLanguageOptions'
import { styles } from '../../theme/styles'

interface TranscriptionOptionsProps {
  readonly installed: readonly TranscriptionModel[]
  readonly model: TranscriptionModel
  readonly language: TranscriptionLanguage
  readonly busy: boolean
  readonly selectModel: (model: TranscriptionModel) => void
  readonly selectLanguage: (language: TranscriptionLanguage) => void
}

export function TranscriptionOptions({ installed, model, language, busy, selectModel, selectLanguage }: TranscriptionOptionsProps) {
  return <View style={styles.transcriptionOptions}>
    <View style={styles.transcriptionOptionGroup}>
      <Text style={[styles.fieldLabel, styles.transcriptionOptionLabel]}>{t('transcription.quality')}</Text>
      <View style={styles.captureKinds}>{transcriptionModels.map(option => {
        const selected = model === option.id && installed.includes(option.id)
        return <Pressable
          accessibilityRole="button"
          accessibilityHint={installed.includes(option.id) ? undefined : t('transcription.model_download_hint')}
          accessibilityState={{ disabled: busy, selected }}
          disabled={busy}
          key={option.id}
          onPress={() => selectModel(option.id)}
          style={[styles.captureKind, selected && styles.captureKindSelected]}>
          <Text style={[styles.captureKindText, selected && styles.captureKindTextSelected]}>{option.id === 'small' ? t('transcription.fast') : t('transcription.accurate')}</Text>
        </Pressable>
      })}</View>
      {model === 'medium' && <Text style={[styles.staleNotice, styles.transcriptionModelNotice]}>{t('transcription.medium_runtime_notice')}</Text>}
    </View>
    <TranscriptionLanguageOptions language={language} busy={busy} selectLanguage={selectLanguage} />
  </View>
}
