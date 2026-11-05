import { Pressable, Text, View } from 'react-native'
import { currentLanguage, t, type Language } from '../../i18n'
import { saveLanguage } from '../../i18n/storage'
import { SettingsCard } from '../../components/ui'
import { styles } from '../../theme/styles'

export function LanguagePanel({ changed }: { readonly changed: (language: Language) => void }) {
  const choose = (language: Language) => {
    if (language === currentLanguage()) return
    void saveLanguage(language).then(() => changed(language))
  }
  const option = (language: Language, label: string) => <Pressable accessibilityRole="button" accessibilityState={{ selected: currentLanguage() === language }} key={language} onPress={() => choose(language)} style={[styles.captureKind, currentLanguage() === language && styles.captureKindSelected]}><Text style={[styles.captureKindText, currentLanguage() === language && styles.captureKindTextSelected]}>{label}</Text></Pressable>
  return <SettingsCard eyebrow={t('settings.language_eyebrow')} title={t('settings.language_title')}>
    <View style={styles.captureKinds}>{option('en', t('settings.english'))}{option('ar', t('settings.arabic'))}</View>
  </SettingsCard>
}
