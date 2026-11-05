import { LibraryPagination } from '../../components/shared'
import { Pressable, Text, View } from 'react-native'
import { t } from '../../i18n'
import { styles } from '../../theme/styles'
import type { LibraryPageSize } from './types'

interface LibraryNavigationProps {
  readonly page: number
  readonly totalPages: number
  readonly busy: boolean
  readonly goToPage: (page: number) => void
  readonly pageSize: LibraryPageSize
  readonly changePageSize: (pageSize: LibraryPageSize) => void
}

export function LibraryNavigation({ pageSize, changePageSize, ...pagination }: LibraryNavigationProps) {
  return <View style={styles.libraryNavigation}>
    <LibraryPagination key={pageSize} {...pagination} compact />
    <View style={styles.libraryPageSizeRow}>
      <Text style={styles.libraryPageSizeLabel}>{t('library.notes_per_page')}</Text>
      <View accessibilityRole="radiogroup" style={styles.libraryPageSizeOptions}>
        {([5, 10, 20] as const).map(size => <Pressable key={size} accessibilityLabel={`${t('library.notes_per_page')}: ${size}`} accessibilityRole="radio" accessibilityState={{ checked: size === pageSize, disabled: pagination.busy }} disabled={pagination.busy} onPress={() => changePageSize(size)} style={[styles.captureKind, styles.libraryPageSizeOption, size === pageSize && styles.captureKindSelected]}>
          <Text style={[styles.captureKindText, size === pageSize && styles.captureKindTextSelected]}>{size}</Text>
        </Pressable>)}
      </View>
    </View>
  </View>
}
