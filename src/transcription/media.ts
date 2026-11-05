const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav'])
const videoExtensions = new Set(['mp4', 'm4v', 'mov', 'mkv', 'webm', '3gp'])

export function transcriptionMediaKind(mediaType: string | null | undefined, filename: string): 'audio' | 'video' | null {
  if (mediaType?.startsWith('audio/') || mediaType === 'application/ogg') return 'audio'
  if (mediaType?.startsWith('video/')) return 'video'
  const extension = filename.toLowerCase().split('.').pop() ?? ''
  if (audioExtensions.has(extension)) return 'audio'
  return videoExtensions.has(extension) ? 'video' : null
}
