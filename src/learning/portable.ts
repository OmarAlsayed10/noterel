import type { LearningDetails } from './schema'

export function readableLearningNotes(title: string, sourceUrl: string | null, details: LearningDetails): string {
  const sections = [`# ${title}`, ...(sourceUrl ? [sourceUrl] : []), details.takeaway]
  if (details.collections.length) sections.push(details.collections.join(', '))
  for (const annotation of details.annotations) {
    if (annotation.quote) sections.push(annotation.quote.split('\n').map(line => `> ${line}`).join('\n'))
    if (annotation.startMs !== null) sections.push(`[${Math.floor(annotation.startMs / 1000)}s]`)
    sections.push(annotation.note)
  }
  return sections.filter(Boolean).join('\n\n')
}
