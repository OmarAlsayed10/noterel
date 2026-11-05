import { Fragment } from 'react'
import { Text } from 'react-native'
import { searchRanges } from '../../library/searchText'
import { palette } from '../../theme/styles'

export function SearchText({ text, query }: { readonly text: string; readonly query: string }) {
  const ranges = searchRanges(text, query)
  return <>{ranges.map((range, index) => {
    const before = text.slice(index ? ranges[index - 1].end : 0, range.start)
    return <Fragment key={range.start}>{before}<Text style={{ color: palette.accent, fontWeight: '700' }}>{text.slice(range.start, range.end)}</Text></Fragment>
  })}{text.slice(ranges.length ? ranges[ranges.length - 1].end : 0)}</>
}
