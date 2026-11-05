import * as DocumentPicker from 'expo-document-picker'
import type { ImageCandidate } from './imageImports'
import type { PdfCandidate } from './pdfImports'
import type { NoteImportCandidate } from '../imports/noteImports'
import type { AudioCandidate } from '../transcription/transcription'

import { readSelectedFile } from './readSelectedFile'

export type FileCategory = 'audio' | 'video' | 'pdf' | 'image' | 'text' | 'archive'
export type ChosenFile = { readonly kind: 'text'; readonly title: string; readonly text: string } | { readonly kind: 'pdf'; readonly pdf: PdfCandidate } | { readonly kind: 'image'; readonly image: ImageCandidate } | { readonly kind: 'notes'; readonly notes: NoteImportCandidate } | { readonly kind: 'audio'; readonly audio: AudioCandidate }

const categoryTypes: Record<FileCategory, readonly string[]> = {
  audio: ['audio/*', 'application/ogg'],
  video: ['video/*'],
  pdf: ['application/pdf'],
  image: ['image/jpeg', 'image/png', 'image/webp'],
  text: ['text/markdown', 'text/plain', 'text/x-markdown'],
  archive: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream']
}

export async function chooseFile(category: FileCategory): Promise<ChosenFile | null> {
  const selected = await DocumentPicker.getDocumentAsync({ type: [...categoryTypes[category]], copyToCacheDirectory: category !== 'video', multiple: false })
  if (selected.canceled) return null
  const asset = selected.assets[0]
  return asset ? readSelectedFile(asset) : null
}
