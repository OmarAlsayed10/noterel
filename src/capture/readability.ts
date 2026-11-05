const minimumWordConfidence = 0.45
const minimumReadableRatio = 0.6
export const unreadableImageMessage = 'This image could not be read reliably. Handwriting and non-Latin text need stronger recognition than this phone provides.'
export const desktopOnlyLinkMessage = 'This site only shows its content to signed-in visitors. Kestrel Desktop can import it.'

const loginWalledHosts = /(^|\.)(facebook\.com|fb\.watch|instagram\.com|threads\.net)$/iu
const loginWallWords = /\b(log ?in|sign ?up)\b|تسجيل الدخول|التسجيل/iu
export const loginWalled = (finalUrl: string, title: string | null): boolean => loginWalledHosts.test(new URL(finalUrl).hostname) && (loginWallWords.test(title ?? '') || /\/login/u.test(new URL(finalUrl).pathname))

export const readableRecognition = (text: string, words: readonly { readonly confidence: number | null }[]): boolean => {
  const readable = [...text].filter(character => /[\p{L}\p{N}\s]/u.test(character)).length
  if (!text || readable / text.length < minimumReadableRatio) return false
  const confidences = words.map(word => word.confidence).filter((value): value is number => value !== null)
  return confidences.length === 0 || confidences.reduce((sum, value) => sum + value, 0) / confidences.length >= minimumWordConfidence
}
