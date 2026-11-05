import type { IncomingShare } from '../capture/incomingShare'

export function conflictPhoneCopy(note: { readonly title: string; readonly text: string }): IncomingShare {
  const suffix = ' (phone copy)'
  const encoder = new TextEncoder()
  let title = ''
  let bytes = encoder.encode(suffix).byteLength
  for (const character of note.title) {
    bytes += encoder.encode(character).byteLength
    if (bytes > 512) break
    title += character
  }
  return { kind: 'note', title: `${title}${suffix}`, text: note.text }
}

export const conflictCopyTooLarge = (note: { readonly title: string; readonly text: string }): boolean => new TextEncoder().encode(JSON.stringify(conflictPhoneCopy(note))).byteLength > 1024 * 1024
