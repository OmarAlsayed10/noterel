import { useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { normalizeIncomingShare } from '../../capture/incomingShare'
import { enqueueCapture } from '../../capture/outbox'
import { Button, ButtonRow } from '../../components/ui'
import { t, tf } from '../../i18n'
import { countMatches, findParts } from '../../notes/MarkdownText'
import { showToast } from '../../toast'
import { installedTranslationModels, translateReading, translationLanguageLabel, type TranslationLanguageCode } from '../../translation/translation'
import { palette, styles } from '../../theme/styles'

export function TranslationPanel({ title, text, openSettings, saved }: { readonly title: string; readonly text: string; readonly openSettings: () => void; readonly saved: () => void }) {
  const [open, setOpen] = useState(false)
  const [installed, setInstalled] = useState<readonly TranslationLanguageCode[]>([])
  const [busy, setBusy] = useState<TranslationLanguageCode | null>(null)
  const [translation, setTranslation] = useState<{ readonly sourceLanguage: string; readonly targetLanguage: TranslationLanguageCode; readonly text: string; readonly truncated: boolean } | null>(null)
  const [needle, setNeedle] = useState('')
  const [compare, setCompare] = useState(false)
  const [saving, setSaving] = useState(false)
  const chooseLanguage = () => {
    void installedTranslationModels().then(models => {
      setInstalled(models)
      setOpen(true)
    }).catch(() => showToast(t('translation.packs_unavailable')))
  }
  const translate = (targetLanguage: TranslationLanguageCode) => {
    setOpen(false)
    setBusy(targetLanguage)
    void translateReading(text, targetLanguage).then(translated => {
      setTranslation({ ...translated, targetLanguage })
      setNeedle('')
      setCompare(false)
    }).catch(error => showToast(error instanceof Error ? error.message : t('translation.translation_failed'))).finally(() => setBusy(null))
  }
  const save = () => {
    if (!translation) return
    setSaving(true)
    const capture = normalizeIncomingShare({ title: `${t('translation.title_prefix')} ${Array.from(title).slice(0, 100).join('')}`, text: translation.text })
    void enqueueCapture(capture).then(() => {
      showToast(t('translation.saved_as_note'))
      setTranslation(null)
      saved()
    }).catch(() => showToast(t('translation.save_failed'))).finally(() => setSaving(false))
  }
  const matches = translation ? countMatches(translation.text, needle.trim()) : 0
  return <>
    <View style={styles.readerActionItem}><Button label={busy ? t('translation.translating') : t('translation.translate')} onPress={chooseLanguage} busy={busy !== null} variant="secondary" /></View>
    <Modal animationType="fade" navigationBarTranslucent onRequestClose={() => setTranslation(null)} statusBarTranslucent transparent visible={translation !== null}>
      <View style={styles.translationModalBackdrop}><View accessibilityViewIsModal style={styles.translationModalSheet}>
        {translation && <><View style={styles.translationModalHeading}><View style={styles.libraryCardCopy}><Text style={styles.eyebrow}>{t('translation.translation_eyebrow')}</Text><Text style={styles.noteSummaryTitle}>{tf('translation.from_to', { source: translationLanguageLabel(translation.sourceLanguage), target: translationLanguageLabel(translation.targetLanguage) })}</Text></View><Pressable accessibilityLabel={t('translation.close_translation')} accessibilityRole="button" onPress={() => setTranslation(null)} style={styles.iconButton}><Text style={styles.iconButtonText}>×</Text></Pressable></View><TextInput autoCapitalize="none" onChangeText={setNeedle} placeholder={t('translation.find_in_translation')} placeholderTextColor={palette.placeholder} selectionColor={palette.link} style={[styles.input, styles.boxedInput, styles.singleLineInput]} value={needle} />{needle.trim() && <Text style={styles.capabilityDetail}>{tf('library.find_matches', { count: matches })}</Text>}<ScrollView contentContainerStyle={styles.translationReading}>{compare && <View style={styles.translationComparison}><Text style={styles.eyebrow}>{t('translation.original_eyebrow')}</Text><Text selectable style={styles.readerText}>{text}</Text></View>}<Text style={styles.eyebrow}>{t('translation.translation_eyebrow')}</Text>{translation.truncated && <Text style={styles.staleNotice}>{t('translation.partial_translation')}</Text>}<Text selectable style={styles.readerText}>{findParts(translation.text, needle.trim())}</Text><Text style={styles.providerDisclaimer}>{t('translation.source_unchanged')} {t('translation.offline_quality_disclosure')}</Text></ScrollView><ButtonRow><Button label={compare ? t('translation.hide_original') : t('translation.compare_with_original')} onPress={() => setCompare(current => !current)} disabled={saving} variant="secondary" /><Button label={t('translation.save_as_note')} onPress={save} busy={saving} /></ButtonRow></>}
      </View></View>
    </Modal>
    <Modal animationType="fade" navigationBarTranslucent onRequestClose={() => setOpen(false)} statusBarTranslucent transparent visible={open}>
      <View style={styles.translationModalBackdrop}><View accessibilityViewIsModal style={styles.translationModalSheet}>
        <View style={styles.translationModalHeading}><View style={styles.libraryCardCopy}><Text style={styles.eyebrow}>{t('translation.translate_eyebrow')}</Text><Text style={styles.panelTitle}>{t('translation.choose_language')}</Text></View><Pressable accessibilityLabel={t('common.close')} accessibilityRole="button" onPress={() => setOpen(false)} style={styles.iconButton}><Text style={styles.iconButtonText}>×</Text></Pressable></View>
        <ScrollView contentContainerStyle={styles.translationModalList}>{installed.length === 0 ? <View><Text style={styles.capabilityDetail}>{t('translation.install_pack_first')}</Text><Button label={t('translation.open_settings')} onPress={() => { setOpen(false); openSettings() }} style={styles.blockButton} /></View> : installed.map(language => <Pressable accessibilityRole="button" key={language} onPress={() => translate(language)} style={styles.translationLanguageChoice}><Text style={styles.capabilityName}>{translationLanguageLabel(language)}</Text><Text style={styles.translationChoiceArrow}>›</Text></Pressable>)}</ScrollView>
      </View></View>
    </Modal>
  </>
}
