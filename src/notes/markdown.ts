export type MarkdownFormat = 'bold' | 'italic' | 'strike' | 'inlineCode' | 'highlight' | 'heading1' | 'heading2' | 'bullet' | 'numbered' | 'quote' | 'codeBlock' | 'link'

export interface TextSelection {
  readonly start: number
  readonly end: number
}

interface FormattedText {
  readonly text: string
  readonly selection: TextSelection
}

const wrappers: Partial<Record<MarkdownFormat, readonly [string, string, string]>> = {
  bold: ['**', '**', 'bold text'],
  italic: ['*', '*', 'italic text'],
  strike: ['~~', '~~', 'struck text'],
  inlineCode: ['`', '`', 'code'],
  highlight: ['==', '==', 'highlighted text'],
  codeBlock: ['```\n', '\n```', 'paste code here'],
  link: ['[', '](https://)', 'link text']
}

const prefixes: Partial<Record<MarkdownFormat, string>> = {
  heading1: '# ',
  heading2: '## ',
  bullet: '- ',
  numbered: '1. ',
  quote: '> '
}

const wrappedText = (text: string, selection: TextSelection, wrapper: readonly [string, string, string]): FormattedText => {
  const selected = text.slice(selection.start, selection.end) || wrapper[2]
  const replacement = `${wrapper[0]}${selected}${wrapper[1]}`
  return { text: `${text.slice(0, selection.start)}${replacement}${text.slice(selection.end)}`, selection: { start: selection.start + wrapper[0].length, end: selection.start + wrapper[0].length + selected.length } }
}

const prefixedText = (text: string, selection: TextSelection, prefix: string): FormattedText => {
  const start = text.lastIndexOf('\n', Math.max(0, selection.start - 1)) + 1
  const endBreak = text.indexOf('\n', selection.end)
  const end = endBreak < 0 ? text.length : endBreak
  const replacement = text.slice(start, end).split('\n').map((line, index) => `${prefix === '1. ' ? `${index + 1}. ` : prefix}${line}`).join('\n')
  return { text: `${text.slice(0, start)}${replacement}${text.slice(end)}`, selection: { start, end: start + replacement.length } }
}

export function applyMarkdownFormat(text: string, selection: TextSelection, format: MarkdownFormat): FormattedText {
  const wrapper = wrappers[format]
  if (wrapper) return wrappedText(text, selection, wrapper)
  return prefixedText(text, selection, prefixes[format]!)
}
