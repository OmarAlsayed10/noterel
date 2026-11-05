import { useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { Button, ButtonRow } from '../../components/ui'
import { errorText, t } from '../../i18n'
import { updateLocalSourceArtifact, type LocalSourceArtifactSummary } from '../../sources/artifacts'
import { palette, styles } from '../../theme/styles'

export function ExtractedTextEditor({ artifact, cancel, saved }: { readonly artifact: LocalSourceArtifactSummary; readonly cancel: () => void; readonly saved: (message: string) => void }) {
  const [title, setTitle] = useState(artifact.title)
  const [text, setText] = useState(artifact.text)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const save = () => {
    setSaving(true)
    setMessage(null)
    void updateLocalSourceArtifact(artifact.sourceId, title, text).then(() => saved(t('library.extracted_text_updated'))).catch(error => setMessage(errorText(error, 'library.extracted_text_could_not_be_updated'))).finally(() => setSaving(false))
  }
  return <View style={styles.readerScreen}>
    <ScrollView contentContainerStyle={styles.editorPage} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>{t('library.edit_extracted_text')}</Text>
      <Text style={styles.fieldLabel}>{t('common.title')}</Text>
      <TextInput editable={!saving} multiline={false} numberOfLines={1} onChangeText={setTitle} selectionColor={palette.link} style={[styles.input, styles.boxedInput, styles.singleLineInput]} value={title} />
      <Text style={styles.fieldLabel}>{t('library.original_source')}</Text>
      <View style={styles.readOnlySource}><Text selectable numberOfLines={2} style={styles.capabilityDetail}>{artifact.finalUrl}</Text></View>
      <Text style={styles.fieldLabel}>{t('library.caption_or_extracted_text')}</Text>
      <TextInput editable={!saving} multiline onChangeText={setText} selectionColor={palette.link} style={[styles.input, styles.boxedInput, styles.captureInput, styles.markdownInput]} textAlignVertical="top" value={text} />
      {message && <Text accessibilityRole="alert" style={styles.quickCaptureError}>{message}</Text>}
      <View style={styles.editorActions}><ButtonRow><Button label={t('common.cancel')} onPress={cancel} disabled={saving} variant="secondary" /><Button label={t('capture.save_changes')} onPress={save} busy={saving} disabled={!title.trim() || !text.trim()} /></ButtonRow></View>
    </ScrollView>
  </View>
}
