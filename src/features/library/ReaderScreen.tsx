import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { codexCredential } from '../../ai/codexAuth'
import { Button } from '../../components/ui'
import { openHttpUrl, safeHttpUrl } from '../../links'
import { countMatches, findParts, MarkdownText } from '../../notes/MarkdownText'
import { palette, styles } from '../../theme/styles'
import type { MobileAtlas } from '../../nodes/atlas'
import type { LocalConnection, ReadingMemory } from './types'
import { t, tf } from '../../i18n'
import { codexEnabled } from '../../edition'
import { ReaderSummaryDialog } from './ReaderSummaryDialog'
import { safeImageUrl } from '../../sources/webpage'
import { MemoryLearningPanel } from '../learning'
import { learningCopy } from '../learning/copy'
import { VideoSourcePreview } from '../capture/VideoSourcePreview'

export function ReaderScreen({ reading, connections, localConnections, back, editCapture, editDesktop, openConnection, openLocal, openSettings, summarySaved, learningEditingChanged }: { readonly reading: ReadingMemory; readonly connections: MobileAtlas['nodes']; readonly localConnections: readonly LocalConnection[]; readonly back: () => void; readonly editCapture: (() => void) | null; readonly editDesktop: (() => void) | null; readonly openConnection: (sourceId: string) => void; readonly openLocal: (connection: LocalConnection) => void; readonly openSettings: () => void; readonly summarySaved: () => void; readonly learningEditingChanged?: (editing: boolean) => void }) {
  const markdown = reading.kind === 'manual_note' || reading.kind === 'pasted_text' || reading.kind === 'url' || reading.mediaType === 'text/markdown'
  const [needle, setNeedle] = useState(reading.searchQuery ?? '')
  const [summaryAvailable, setSummaryAvailable] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [learningDirty, setLearningDirty] = useState(false)
  const [focusedQuote, setFocusedQuote] = useState<string | null>(null)
  const scroll = useRef<ScrollView>(null)
  const learningPosition = useRef(0)
  const editingChanged = useCallback((editing: boolean) => { setLearningDirty(editing); learningEditingChanged?.(editing) }, [learningEditingChanged])
  const leaveReader = (proceed: () => void) => {
    if (!learningDirty) { proceed(); return }
    Alert.alert(learningCopy('unsavedTitle'), learningCopy('unsavedDetail'), [{ text: learningCopy('keepEditing'), style: 'cancel' }, { text: learningCopy('discard'), style: 'destructive', onPress: proceed }])
  }
  const focusQuote = (quote: string) => { setNeedle(quote); setFocusedQuote(quote); scroll.current?.scrollTo({ y: 0, animated: true }) }
  const sourceUrl = safeHttpUrl(reading.url)
  const matches = countMatches(reading.text, needle.trim())
  useEffect(() => {
    if (!codexEnabled) return
    void codexCredential().then(credential => setSummaryAvailable(credential !== null), () => setSummaryAvailable(false))
  }, [])
  return <View style={styles.readerScreen}>
    <View style={styles.readerHeader}>
      <Pressable accessibilityLabel={t('library.back_to_library')} accessibilityRole="button" onPress={() => leaveReader(back)} style={styles.backButton}><Text style={styles.backButtonText}>{t('library.back')}</Text></Pressable>
      <Text numberOfLines={1} style={styles.readerTitle}>{reading.title}</Text>
      {editCapture && <Pressable accessibilityLabel={t('common.edit')} accessibilityRole="button" onPress={() => leaveReader(editCapture)} style={styles.readerEditButton}><Text style={styles.readerEditText}>{t('common.edit')}</Text></Pressable>}
      {editDesktop && <Pressable accessibilityLabel={t('library.edit_desktop_note')} accessibilityRole="button" onPress={() => leaveReader(editDesktop)} style={styles.readerEditButton}><Text style={styles.readerEditText}>{t('common.edit')}</Text></Pressable>}
    </View>
    <ScrollView ref={scroll} contentContainerStyle={styles.readerPage}>
      <View style={styles.notesSearch}><TextInput accessibilityLabel={t('library.find_in_note')} autoCapitalize="none" onChangeText={setNeedle} placeholder={t('library.find_in_note')} placeholderTextColor={palette.placeholder} selectionColor={palette.link} style={[styles.input, styles.boxedInput, styles.notesSearchInput]} value={needle} />{needle.trim() ? <Text accessibilityLiveRegion="polite" style={styles.capabilityDetail}>{tf('library.find_matches', { count: matches })}</Text> : null}</View>
      {reading.stale && <Text accessibilityLiveRegion="polite" style={styles.staleNotice}>{t('library.this_offline_copy_may_be_older_than')}</Text>}
      {focusedQuote && reading.text.includes(focusedQuote) && <Text selectable accessibilityLiveRegion="polite" style={styles.readerText}>{findParts(reading.text.slice(Math.max(0, reading.text.indexOf(focusedQuote) - 120), reading.text.indexOf(focusedQuote) + focusedQuote.length + 120), focusedQuote)}</Text>}
      <View style={styles.readerActions}>
        <Button label={learningCopy('title')} onPress={() => scroll.current?.scrollTo({ y: learningPosition.current, animated: true })} variant="secondary" style={styles.readerActionItem} />
        {sourceUrl && !reading.transcriptionSource && <Button accessibilityRole="link" label={t('library.source')} onPress={() => openHttpUrl(sourceUrl.toString())} variant="secondary" style={styles.readerActionItem} />}
        {summaryAvailable && reading.text.trim() && <Button label={t('summary.summarize_note')} onPress={() => setSummaryOpen(true)} variant="secondary" style={styles.readerActionItem} />}
      </View>
      {reading.transcriptionSource && <VideoSourcePreview source={reading.transcriptionSource} />}
      {reading.imageUrls?.map((url, index) => {
        const media = safeImageUrl(url, reading.url ?? 'https://kestrel.invalid/')
        return media ? <Pressable accessibilityLabel={tf('library.post_image', { number: index + 1 })} accessibilityRole="link" key={media} onPress={() => openHttpUrl(media)}><Image resizeMode="contain" source={{ uri: media }} style={styles.readerPostImage} /></Pressable> : null
      })}
      {!reading.text ? <Text style={styles.readerText}>{t('library.no_readable_text_was_found_in_this')}</Text> : markdown ? <MarkdownText text={reading.text} needle={needle.trim()} /> : <Text selectable style={styles.readerText}>{findParts(reading.text, needle.trim())}</Text>}
      <View onLayout={event => { learningPosition.current = event.nativeEvent.layout.y }}><MemoryLearningPanel reading={reading} focusQuote={focusQuote} editingChanged={editingChanged} /></View>
      {(connections.length > 0 || localConnections.length > 0) && <View style={styles.connectionsPanel}>
        <Text style={styles.fieldLabel}>{t('library.related_memories')}</Text>
        <Text style={styles.connectionExplanation}>{t('library.suggested_from_shared_wording_tap_a_memory')}</Text>
        {connections.map(node => <Pressable accessibilityLabel={node.label} accessibilityRole="button" key={node.id} onPress={() => leaveReader(() => openConnection(node.sourceId))} style={styles.connectionRow}><View style={styles.nodeMark} /><View style={styles.libraryCardCopy}><Text style={styles.capabilityName}>{node.label}</Text><Text numberOfLines={2} style={styles.capabilityDetail}>{node.summary}</Text></View></Pressable>)}
        {localConnections.map(connection => <Pressable accessibilityLabel={connection.title} accessibilityRole="button" key={connection.sourceId} onPress={() => leaveReader(() => openLocal(connection))} style={styles.connectionRow}><View style={styles.nodeMark} /><View style={styles.libraryCardCopy}><Text style={styles.capabilityName}>{connection.title}</Text><Text numberOfLines={2} style={styles.capabilityDetail}>{connection.text}</Text></View></Pressable>)}
      </View>}
    </ScrollView>
    <ReaderSummaryDialog reading={reading} visible={summaryOpen} close={() => setSummaryOpen(false)} openSettings={() => { setSummaryOpen(false); openSettings() }} saved={() => { setSummaryOpen(false); summarySaved() }} />
  </View>
}
