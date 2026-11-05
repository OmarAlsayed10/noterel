import type { MarkdownFormat } from '../notes/markdown'

export const markdownActions: readonly { format: MarkdownFormat; label: string; mark: string }[] = [
  { format: 'bold', label: 'Bold', mark: 'B' },
  { format: 'italic', label: 'Italic', mark: 'I' },
  { format: 'strike', label: 'Strikethrough', mark: 'S' },
  { format: 'inlineCode', label: 'Inline code', mark: '</>' },
  { format: 'codeBlock', label: 'Code block', mark: '{ }' },
  { format: 'heading1', label: 'Heading 1', mark: 'H1' },
  { format: 'heading2', label: 'Heading 2', mark: 'H2' },
  { format: 'bullet', label: 'Bulleted list', mark: '•' },
  { format: 'numbered', label: 'Numbered list', mark: '1.' },
  { format: 'quote', label: 'Quote', mark: '❯' },
  { format: 'link', label: 'Link', mark: '↗' },
  { format: 'highlight', label: 'Highlight', mark: '==' }
]
