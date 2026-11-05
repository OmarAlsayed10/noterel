import { Linking, Text, View } from 'react-native'
import { styles } from '../theme/styles'
import type { ReactNode } from 'react'
import { phraseSearchRanges } from '../library/searchText'

type InlineKind = 'bold' | 'italic' | 'strike' | 'code' | 'highlight' | 'link' | 'hashtag'

const inlinePattern = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*\n]+)\*\*|~~([^~\n]+)~~|==([^=\n]+)==|`([^`\n]+)`|\*([^*\n]+)\*|(https?:\/\/[^\s<]+)|(#[\p{L}\p{N}_-]+))/gu

const inlineStyle = (kind: InlineKind) => kind === 'bold' ? styles.mdBold : kind === 'italic' ? styles.mdItalic : kind === 'strike' ? styles.mdStrike : kind === 'code' ? styles.mdInlineCode : kind === 'highlight' ? styles.mdHighlight : kind === 'hashtag' ? styles.mdHashtag : styles.mdLink

export const findParts = (text: string, needle: string, keyPrefix = ''): ReactNode[] => {
  if (!needle) return [text]
  const parts: ReactNode[] = []
  let offset = 0
  for (const range of phraseSearchRanges(text, needle)) {
    if (range.start > offset) parts.push(text.slice(offset, range.start))
    parts.push(<Text key={`${keyPrefix}find-${range.start}`} style={styles.findMatch}>{text.slice(range.start, range.end)}</Text>)
    offset = range.end
  }
  if (offset < text.length) parts.push(text.slice(offset))
  return parts
}

export const countMatches = (text: string, needle: string): number => phraseSearchRanges(text, needle).length

const inlineParts = (text: string, needle: string): ReactNode[] => {
  const parts: ReactNode[] = []
  let offset = 0
  for (const match of text.matchAll(inlinePattern)) {
    if (match.index > offset) parts.push(...findParts(text.slice(offset, match.index), needle, `${offset}-`))
    const kind: InlineKind = match[2] || match[9] ? 'link' : match[4] ? 'bold' : match[5] ? 'strike' : match[6] ? 'highlight' : match[7] ? 'code' : match[8] ? 'italic' : 'hashtag'
    const content = match[2] ?? match[4] ?? match[5] ?? match[6] ?? match[7] ?? match[8] ?? match[9] ?? match[10]
    const link = match[3] ?? match[9]
    parts.push(<Text key={`${match.index}-${kind}`} onPress={link ? () => void Linking.openURL(link) : undefined} style={inlineStyle(kind)}>{findParts(content ?? '', needle, `${match.index}-`)}</Text>)
    offset = match.index + match[0].length
  }
  if (offset < text.length) parts.push(...findParts(text.slice(offset), needle, `${offset}-`))
  return parts
}

function MarkdownLine({ line, lineNumber, needle }: { readonly line: string; readonly lineNumber: number; readonly needle: string }) {
  const heading = /^(#{1,2})\s+(.+)$/.exec(line)
  if (heading) return <Text style={heading[1].length === 1 ? styles.mdHeading1 : styles.mdHeading2}>{inlineParts(heading[2], needle)}</Text>
  const list = /^(?:- |\d+\. )(.+)$/.exec(line)
  if (list) return <View style={styles.mdListRow}><Text style={styles.mdListMark}>{line.startsWith('- ') ? '•' : line.slice(0, line.indexOf('.') + 1)}</Text><Text selectable style={styles.mdBody}>{inlineParts(list[1], needle)}</Text></View>
  const quote = /^>\s?(.+)$/.exec(line)
  if (quote) return <View style={styles.mdQuote}><Text selectable style={styles.mdQuoteText}>{inlineParts(quote[1], needle)}</Text></View>
  return <Text key={lineNumber} selectable style={styles.mdBody}>{inlineParts(line, needle)}</Text>
}

const codeFenceEnd = (lines: readonly string[], start: number): number => {
  const relativeEnd = lines.slice(start + 1).findIndex(line => line.startsWith('```'))
  return relativeEnd < 0 ? lines.length : start + relativeEnd + 1
}

export function MarkdownText({ text, needle = '' }: { readonly text: string; readonly needle?: string }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (!line.trim()) continue
    if (!line.startsWith('```')) {
      blocks.push(<MarkdownLine key={index} line={line} lineNumber={index} needle={needle} />)
      continue
    }
    const end = codeFenceEnd(lines, index)
    blocks.push(<View key={`code-${index}`} style={styles.mdCodeBlock}><Text selectable style={styles.mdCodeText}>{findParts(lines.slice(index + 1, end).join('\n'), needle, `code-${index}-`)}</Text></View>)
    index = end
  }
  return <View style={styles.mdMarkdown}>{blocks}</View>
}
