import type { LearningDetails, MemoryIdentity } from '../learning'

export interface ReadableMemory {
  readonly identity: MemoryIdentity
  readonly title: string
  readonly text: string
  readonly url: string | null
}

function annotationMarkdown(details: LearningDetails): string {
  return details.annotations.map(annotation => [
    annotation.startMs === null ? '' : `Time: ${annotation.startMs / 1000} s`,
    annotation.quote ? annotation.quote.split('\n').map(line => `> ${line}`).join('\n') : '',
    annotation.note
  ].filter(Boolean).join('\n\n')).join('\n\n')
}

export function readableMemoryMarkdown(memory: ReadableMemory, details: LearningDetails): string {
  return [
    `# ${memory.title.replace(/\r?\n/gu, ' ')}`,
    memory.url ? `Source: ${memory.url}` : '',
    details.collections.length ? `Collections: ${details.collections.join(', ')}` : '',
    details.revisit ? 'Selected to revisit' : '',
    memory.text,
    details.takeaway ? `## My takeaway\n\n${details.takeaway}` : '',
    details.annotations.length ? `## My annotations\n\n${annotationMarkdown(details)}` : ''
  ].filter(Boolean).join('\n\n')
}
