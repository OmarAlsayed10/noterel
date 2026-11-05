import type { DocumentPickerAsset } from 'expo-document-picker'
import { File } from 'expo-file-system'
import type { ImageCandidate } from './imageImports'
import type { ChosenFile } from './chooseFile'
import { transcriptionMediaKind } from '../transcription/media'

const maximumTextFileBytes = 1024 * 1024
const maximumPdfBytes = 16 * 1024 * 1024
const maximumImageBytes = 12 * 1024 * 1024
const imageTypes: Record<string, ImageCandidate['mediaType']> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export async function readSelectedFile(asset: DocumentPickerAsset): Promise<ChosenFile> {
  const extension = asset.name.toLowerCase().split('.').pop() ?? ''
  if (extension === 'pdf') {
    if (!asset.size || asset.size > maximumPdfBytes) throw new RangeError(`Choose a PDF no larger than ${maximumPdfBytes / 1024 / 1024} MiB`)
    return { kind: 'pdf', pdf: { uri: asset.uri, filename: asset.name, size: asset.size } }
  }
  if (extension === 'zip' || extension === 'apkg') {
    const { readNoteImport } = await import('../imports/noteImports')
    return { kind: 'notes', notes: await readNoteImport(asset.uri, asset.name, asset.size) }
  }
  const mediaKind = transcriptionMediaKind(asset.mimeType, asset.name)
  if (mediaKind) {
    if (!Number.isFinite(asset.size) || !asset.size || asset.size < 0 || asset.size > 128 * 1024 * 1024) throw new RangeError('Choose audio or video no larger than 128 MiB')
    return { kind: 'audio', audio: { uri: asset.uri, filename: asset.name, size: asset.size, mediaType: asset.mimeType ?? `${mediaKind}/*` } }
  }
  const imageType = imageTypes[extension]
  if (imageType) {
    if (!asset.size || asset.size > maximumImageBytes) throw new RangeError('Choose an image no larger than 12 MiB')
    return { kind: 'image', image: { uri: asset.uri, filename: asset.name, size: asset.size, mediaType: imageType } }
  }
  if (!['md', 'markdown', 'txt', 'text'].includes(extension)) throw new RangeError('Choose a PDF, image, note, ZIP, or Anki package')
  if (asset.size && asset.size > maximumTextFileBytes) throw new RangeError('Text files are limited to 1 MiB')
  const bytes = await new File(asset.uri).arrayBuffer()
  if (bytes.byteLength > maximumTextFileBytes) throw new RangeError('Text files are limited to 1 MiB')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/gu, '\n').trim()
  if (!text) throw new RangeError('This file has no text')
  return { kind: 'text', title: asset.name.replace(/\.[^.]+$/u, ''), text }
}
