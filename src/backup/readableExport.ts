import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { readableNotebook } from './readableNotebook'

export { readableNotebook } from './readableNotebook'
export { readableMemoryMarkdown } from './readableMarkdown'

export async function shareReadableNotebook(collection = ''): Promise<number> {
  const notebook = await readableNotebook(collection)
  if (!FileSystem.cacheDirectory) throw new Error('Export storage is unavailable')
  if (!await Sharing.isAvailableAsync()) throw new Error('Android sharing is unavailable')
  const path = `${FileSystem.cacheDirectory}noterel-notes-${Date.now()}.md`
  await FileSystem.writeAsStringAsync(path, notebook.contents, { encoding: FileSystem.EncodingType.UTF8 })
  await Sharing.shareAsync(path, { mimeType: 'text/markdown', dialogTitle: 'Save readable notes' })
  return notebook.count
}
