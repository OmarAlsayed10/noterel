import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Button, ButtonRow, SettingsCard } from '../../components/ui'
import { t } from '../../i18n'
import { saveTheme } from '../../theme/storage'
import { styles } from '../../theme/styles'
import { currentTheme, fontScales, type Theme, type ThemeMode } from '../../theme/theme'

export function AppearancePanel({ changed }: { readonly changed: (theme: Theme) => void }) {
  const [draft, setDraft] = useState<Theme>(currentTheme())
  const saved = currentTheme()
  const dirty = draft.mode !== saved.mode || draft.fontScale !== saved.fontScale
  const index = fontScales.indexOf(draft.fontScale as typeof fontScales[number])
  const step = (direction: -1 | 1) => {
    const next = fontScales[Math.min(fontScales.length - 1, Math.max(0, index + direction))]
    if (next !== undefined) setDraft({ ...draft, fontScale: next })
  }
  const mode = (value: ThemeMode, label: string) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: draft.mode === value }} key={value} onPress={() => setDraft({ ...draft, mode: value })} style={[styles.captureKind, draft.mode === value && styles.captureKindSelected]}><Text style={[styles.captureKindText, draft.mode === value && styles.captureKindTextSelected]}>{label}</Text></Pressable>
  return <SettingsCard eyebrow={t('settings.appearance_eyebrow')} title={t('settings.appearance_title')}>
    <View style={styles.captureKinds}>{mode('light', t('settings.theme_light'))}{mode('dark', t('settings.theme_dark'))}</View>
    <Text style={styles.capabilityDetail}>{t('settings.font_size')} · {Math.round(draft.fontScale * 100)}%</Text>
    <View style={styles.fontSizeRow}>
      <Button label="A−" onPress={() => step(-1)} disabled={index <= 0} variant="secondary" style={styles.fontSizeButton} />
      <Button label="A+" onPress={() => step(1)} disabled={index >= fontScales.length - 1} variant="secondary" style={styles.fontSizeButton} />
    </View>
    <View style={[styles.fontPreview, { backgroundColor: draft.mode === 'dark' ? '#1C2637' : '#FFFDF7' }]}>
      <Text style={{ color: draft.mode === 'dark' ? '#F5F1E8' : '#17253B', fontSize: Math.round(16 * draft.fontScale), lineHeight: Math.round(26 * draft.fontScale) }}>{t('settings.font_preview_text')}</Text>
    </View>
    <ButtonRow><Button label={t('common.save')} onPress={() => { void saveTheme(draft).then(() => changed(draft)) }} disabled={!dirty} /></ButtonRow>
  </SettingsCard>
}
