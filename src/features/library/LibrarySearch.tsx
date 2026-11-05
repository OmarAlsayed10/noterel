import { Pressable, Text, TextInput, View } from 'react-native'
import { currentLanguage, t } from '../../i18n'
import { palette, styles } from '../../theme/styles'
import type { LibraryScope } from './types'
import { LibraryScopeSelector } from './LibraryScopeSelector'

interface LibrarySearchProps {
  readonly search: { readonly text: string; readonly change: (text: string) => void; readonly submit: () => void }
  readonly scope: { readonly selected: LibraryScope; readonly choose: (scope: LibraryScope) => void }
  readonly filters: { readonly open: boolean; readonly toggle: () => void; readonly active: boolean }
}

export function LibrarySearch({ search, scope, filters }: LibrarySearchProps) {
  return <>
    <View style={styles.notesSearch}>
      <TextInput accessibilityLabel={t('library.search_notes_and_memories')} autoCapitalize="none" onChangeText={search.change} onSubmitEditing={search.submit} placeholder={t('library.search_notes_and_memories')} placeholderTextColor={palette.placeholder} returnKeyType="search" selectionColor={palette.link} style={[styles.input, styles.boxedInput, styles.notesSearchInput]} value={search.text} />
      <Pressable accessibilityRole="button" onPress={search.submit} style={styles.notesSearchButton}><Text style={styles.notesSearchButtonText}>{t('common.search')}</Text></Pressable>
      <Pressable accessibilityLabel={t('library.filter_memories')} accessibilityRole="button" accessibilityState={{ expanded: filters.open }} onPress={filters.toggle} style={[styles.refreshButton, filters.active && styles.scopeActive]}><Text numberOfLines={1} style={styles.refreshButtonText}>{currentLanguage() === 'ar' ? 'فلاتر' : 'Filters'}</Text></Pressable>
    </View>
    {filters.open && <LibraryScopeSelector selected={scope.selected} choose={scope.choose} />}
  </>
}
