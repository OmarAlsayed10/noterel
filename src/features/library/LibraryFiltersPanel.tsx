import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { currentLanguage } from '../../i18n'
import { emptyLibraryFilters, sourceHostname, type LibraryFilters } from '../../library/searchQuery'
import { palette, styles } from '../../theme/styles'
import { Button } from '../../components/ui'

const copy = {
  type: ['Type', 'النوع'], date: ['Updated', 'آخر تحديث'], all: ['All', 'الكل'], note: ['Notes', 'ملاحظات'], url: ['Links', 'روابط'], video: ['Videos', 'فيديو'], pdf: ['PDF', 'PDF'], image: ['Images', 'صور'], any: ['Any time', 'كل الأوقات'], week: ['Last 7 days', 'آخر ٧ أيام'], month: ['Last 30 days', 'آخر ٣٠ يومًا'], collections: ['Collections', 'المجموعات'], revisit: ['Selected to revisit', 'مختارة للمراجعة'], reset: ['Clear filters', 'مسح الفلاتر'], source: ['Website', 'الموقع'], apply: ['Apply website', 'تطبيق الموقع'], invalidSource: ['Enter a website such as youtube.com', 'أدخل موقعًا مثل youtube.com']
} as const

const label = (key: keyof typeof copy) => copy[key][currentLanguage() === 'ar' ? 1 : 0]
const choiceLayout = { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as const

function FilterChoice({ text, selected, choose }: { readonly text: string; readonly selected: boolean; readonly choose: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={choose} style={[styles.captureKind, selected && styles.captureKindSelected]}><Text style={[styles.captureKindText, selected && styles.captureKindTextSelected]}>{text}</Text></Pressable>
}

function WebsiteFilter({ source, apply }: { readonly source: string; readonly apply: (source: string) => void }) {
  const [draft, setDraft] = useState(source)
  const [invalid, setInvalid] = useState(false)
  const submit = () => { try { apply(sourceHostname(draft)) } catch { setInvalid(true) } }
  return <View style={{ gap: 8 }}>
    <Text style={styles.fieldLabel}>{label('source')}</Text>
    <TextInput accessibilityLabel={label('source')} autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={253} onChangeText={text => { setDraft(text); setInvalid(false) }} onSubmitEditing={submit} placeholder="youtube.com" placeholderTextColor={palette.placeholder} style={[styles.input, styles.boxedInput, { writingDirection: 'ltr', textAlign: 'left' }]} value={draft} />
    {invalid && <Text accessibilityRole="alert" style={styles.inlineFailure}>{label('invalidSource')}</Text>}
    <Button label={label('apply')} onPress={submit} variant="secondary" />
  </View>
}

export function LibraryFiltersPanel({ filters, collections, change }: { readonly filters: LibraryFilters; readonly collections: readonly string[]; readonly change: (filters: LibraryFilters) => void }) {
  const kinds = ['all', 'manual_note', 'url', 'video', 'pdf', 'image'] as const
  const [referenceTime] = useState(() => Date.now())
  const age = filters.sinceMs === null ? 0 : referenceTime - filters.sinceMs
  return <View style={{ gap: 8, paddingVertical: 12 }}>
    <WebsiteFilter key={filters.source} source={filters.source} apply={source => change({ ...filters, source })} />
    <Text style={styles.fieldLabel}>{label('type')}</Text>
    <View style={choiceLayout}>{kinds.map(kind => <FilterChoice key={kind} text={label(kind === 'manual_note' ? 'note' : kind)} selected={filters.kind === kind} choose={() => change({ ...filters, kind })} />)}</View>
    <Text style={styles.fieldLabel}>{label('date')}</Text>
    <View style={choiceLayout}>{([0, 7, 30] as const).map(days => <FilterChoice key={days} text={label(days === 0 ? 'any' : days === 7 ? 'week' : 'month')} selected={days === 0 ? filters.sinceMs === null : days === 7 ? age > 0 && age < 8 * 86400000 : age >= 8 * 86400000} choose={() => change({ ...filters, sinceMs: days ? Date.now() - days * 86400000 : null })} />)}</View>
    {collections.length > 0 && <><Text style={styles.fieldLabel}>{label('collections')}</Text><View style={choiceLayout}><FilterChoice text={label('all')} selected={!filters.collection} choose={() => change({ ...filters, collection: '' })} />{collections.map(collection => <FilterChoice key={collection} text={collection} selected={filters.collection === collection} choose={() => change({ ...filters, collection })} />)}</View></>}
    <View style={[styles.captureKinds, { flexWrap: 'wrap' }]}><FilterChoice text={label('revisit')} selected={filters.revisitOnly} choose={() => change({ ...filters, revisitOnly: !filters.revisitOnly })} /><FilterChoice text={label('reset')} selected={false} choose={() => change(emptyLibraryFilters())} /></View>
  </View>
}
