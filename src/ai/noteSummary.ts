const summarySourceMaximumBytes = 40 * 1024

const boundedUtf8 = (text: string, maximumBytes: number): string => {
  if (new TextEncoder().encode(text).byteLength <= maximumBytes) return text
  let lower = 0
  let upper = Math.min(text.length, maximumBytes)
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2)
    if (new TextEncoder().encode(text.slice(0, middle)).byteLength <= maximumBytes) lower = middle
    else upper = middle - 1
  }
  const safeEnd = lower > 0 && text.charCodeAt(lower - 1) >= 0xd800 && text.charCodeAt(lower - 1) <= 0xdbff ? lower - 1 : lower
  return text.slice(0, safeEnd)
}

export function summarySourceText(text: string): { readonly text: string; readonly truncated: boolean } {
  if (new TextEncoder().encode(text).byteLength <= summarySourceMaximumBytes) return { text, truncated: false }
  return { text: boundedUtf8(text, summarySourceMaximumBytes), truncated: true }
}

export const summaryNoteTitle = (prefix: string, title: string): string => boundedUtf8(`${prefix} ${title}`.trim(), 512)
