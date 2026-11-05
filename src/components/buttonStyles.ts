import { StyleSheet } from 'react-native'
import type { ThemeTokens } from '../theme/theme'

export const createButtonStyles = ({ colors, font }: ThemeTokens) => StyleSheet.create({
  buttonBase: { alignItems: 'center', alignSelf: 'stretch', borderRadius: 12, flexBasis: 'auto', flexGrow: 0, flexShrink: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', maxWidth: '100%', minHeight: 48, minWidth: 0, paddingHorizontal: 16, paddingVertical: 13 },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: 'transparent', borderColor: colors.outline, borderWidth: 1 },
  buttonDanger: { backgroundColor: '#AA3434' },
  buttonLabel: { flexShrink: 1, fontSize: font(14), fontWeight: '700', lineHeight: font(20), minWidth: 0, textAlign: 'center' },
  buttonPrimaryText: { color: colors.onPrimary },
  buttonSecondaryText: { color: colors.link },
  buttonRow: { alignItems: 'stretch', flexDirection: 'column', gap: 10 },
  buttonPressed: { opacity: 0.78 },
  buttonDisabled: { opacity: 0.5 }
})
