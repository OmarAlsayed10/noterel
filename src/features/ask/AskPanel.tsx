import { entireBrainContexts, selectedAskContexts } from './askContexts'
import { codexCredential } from '../../ai/codexAuth'
import { askCodex } from '../../ai/codexClient'
import { MarkdownText } from '../../notes/MarkdownText'
import { Button } from '../../components/ui'
import { palette, styles } from '../../theme/styles'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { AskContext } from '../../ai/codexClient'
import type { ConnectionState, SelectedAskMemory } from '../../types'
import { ScreenHeading } from '../../components/shared'
import { t, errorText } from '../../i18n'

interface AskPanelProps {
  readonly connectionState: ConnectionState
  readonly openSettings: () => void
  readonly chooseMemories: () => void
  readonly removeMemory: (sourceId: string) => void
  readonly selectedMemories: readonly SelectedAskMemory[]
}

export function AskPanel({ connectionState, openSettings, chooseMemories, removeMemory, selectedMemories }: AskPanelProps) {
  const [mode, setMode] = useState<'brain' | 'selected'>(selectedMemories.length > 0 ? 'selected' : 'brain')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [message, setMessage] = useState(t('ask.ask_across_all_available_memory_or_use'))
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [sources, setSources] = useState<readonly AskContext[]>([])
  const [busy, setBusy] = useState(false)
  const requestController = useRef<AbortController | null>(null)
  const refresh = useCallback(() => {
    void codexCredential().then(credential => setSignedIn(credential !== null)).catch(error => setMessage(errorText(error, 'ask.ask_is_unavailable')))
  }, [])
  useEffect(refresh, [refresh])
  useEffect(() => () => requestController.current?.abort(), [])
  const ask = () => {
    if (busy || !question.trim()) return
    const controller = new AbortController()
    requestController.current = controller
    setBusy(true)
    setAnswer('')
    setSources([])
    setMessage(mode === 'brain' ? t('ask.finding_relevant_memory_from_the_available_brain') : t('ask.finding_evidence_inside_the_selected_memories'))
    const contextRequest = mode === 'brain' ? entireBrainContexts(question, connectionState) : selectedAskContexts(question, selectedMemories, connectionState)
    void contextRequest.then(contexts => {
      if (contexts.length === 0) throw new Error(mode === 'brain' ? t('ask.no_searchable_memories_are_available') : t('ask.choose_at_least_one_searchable_memory'))
      setSources(contexts)
      setMessage(t('ask.codex_is_answering_from_the_retrieved_evidence'))
      return askCodex(question, contexts, setAnswer, controller.signal)
    }).then(completedAnswer => {
      setAnswer(completedAnswer)
      setMessage(t('ask.codex_answer_complete_this_answer_is_not'))
    }).catch(error => {
      if (!controller.signal.aborted) setMessage(errorText(error, 'ask.codex_could_not_answer_this_question'))
    }).finally(() => {
      if (requestController.current === controller) requestController.current = null
      setBusy(false)
    })
  }
  const cancel = () => {
    requestController.current?.abort()
    requestController.current = null
    setBusy(false)
    setMessage(t('ask.ask_cancelled'))
  }
  return <ScrollView contentContainerStyle={styles.tabPage}>
    <ScreenHeading eyebrow={t('ask.ask_eyebrow')} title={t('ask.ask_with_codex')} summary={t('ask.use_relevant_memories_from_the_available_brain')} />
    <View style={styles.panel}>
      {signedIn === false && <View style={styles.askSignIn}><Text style={styles.capabilityDetail}>{t('ask.codex_is_not_signed_in_on_this')}</Text><Pressable accessibilityRole="button" onPress={openSettings} style={styles.refreshButton}><Text style={styles.refreshButtonText}>{t('ask.open_settings')}</Text></Pressable></View>}
      <View style={styles.captureKinds}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === 'brain' }} onPress={() => setMode('brain')} style={[styles.captureKind, mode === 'brain' && styles.captureKindSelected]}><Text style={[styles.captureKindText, mode === 'brain' && styles.captureKindTextSelected]}>{t('ask.entire_brain')}</Text></Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === 'selected' }} onPress={() => setMode('selected')} style={[styles.captureKind, mode === 'selected' && styles.captureKindSelected]}><Text style={[styles.captureKindText, mode === 'selected' && styles.captureKindTextSelected]}>{t('ask.selected_memories')}</Text></Pressable>
      </View>
      <Text style={styles.askModeDetail}>{mode === 'brain' ? connectionState === 'connected' || connectionState === 'paired' ? t('ask.searches_desktop_and_encrypted_memory_on_this') : t('ask.desktop_is_unavailable_so_this_searches_encrypted') : t('ask.uses_only_the_memories_listed_below')}</Text>
      {mode === 'selected' && <View style={styles.selectedMemories}><View style={styles.libraryToolbar}><Text style={styles.fieldLabel}>{selectedMemories.length} selected</Text><Pressable accessibilityRole="button" onPress={chooseMemories} style={styles.refreshButton}><Text style={styles.refreshButtonText}>{t('ask.choose_from_search')}</Text></Pressable></View>{selectedMemories.map(memory => <View key={memory.sourceId} style={styles.selectedMemory}><Text numberOfLines={1} style={[styles.capabilityName, styles.selectedMemoryTitle]}>{memory.title}</Text><Pressable accessibilityLabel={`Remove ${memory.title}`} accessibilityRole="button" onPress={() => removeMemory(memory.sourceId)} style={styles.selectedMemoryRemove}><Text style={styles.libraryDeleteText}>{t('common.remove')}</Text></Pressable></View>)}</View>}
      <Text style={styles.fieldLabel}>{t('ask.question')}</Text><TextInput editable={!busy} multiline onChangeText={setQuestion} placeholder={t('ask.what_do_my_notes_say_about')} placeholderTextColor={palette.placeholder} selectionColor={palette.link} style={[styles.input, styles.boxedInput, styles.askInput]} textAlignVertical="top" value={question} />
      <Text style={styles.capabilityDetail}>{message}</Text>
      {busy ? <Button label={t('common.cancel')} onPress={cancel} variant="secondary" style={styles.blockButton} /> : <Button label={t('ask.ask_codex')} onPress={ask} disabled={!signedIn || !question.trim() || (mode === 'selected' && selectedMemories.length === 0)} style={styles.blockButton} />}
    </View>
    {answer && <View style={styles.answerPanel}><Text style={styles.eyebrow}>{t('ask.codex_answer_eyebrow')}</Text><MarkdownText text={answer} />{sources.length > 0 && <View style={styles.answerSources}><Text style={styles.fieldLabel}>{t('ask.supporting_sources')}</Text>{sources.map((source, index) => <Text key={`${source.sourceId}-${index}`} style={styles.capabilityDetail}>[{index + 1}] {source.title}</Text>)}</View>}</View>}
  </ScrollView>
}
