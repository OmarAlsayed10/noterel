import { StyleSheet } from 'react-native'

export const learningStyles = StyleSheet.create({
  section: { gap: 12, marginTop: 28 },
  annotation: { gap: 8, paddingVertical: 14 },
  textArea: { minHeight: 104, textAlignVertical: 'top' },
  shortText: { minHeight: 64, textAlignVertical: 'top' },
  switch: { minHeight: 48, justifyContent: 'center', paddingVertical: 12 },
  navigation: { gap: 8, flexDirection: 'row', flexWrap: 'wrap' },
  moment: { minWidth: 64 },
  heading: { fontWeight: '700' }
})
