import { normalizedSearchSql, normalizedSearchText, searchTerms } from './searchText'

export interface LibraryFilters {
  readonly kind: 'all' | 'manual_note' | 'url' | 'video' | 'pdf' | 'image'
  readonly sinceMs: number | null
  readonly collection: string
  readonly revisitOnly: boolean
  readonly source: string
}

export const emptyLibraryFilters = (): LibraryFilters => ({ kind: 'all', sinceMs: null, collection: '', revisitOnly: false, source: '' })

export function sourceHostname(input: string): string {
  if (!input.trim()) return ''
  const url = new URL(input.includes('://') ? input.trim() : `https://${input.trim()}`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !/^[a-z0-9.-]+(?::\d+)?$/iu.test(url.host)) throw new RangeError('Enter a website such as youtube.com')
  return url.host.toLowerCase().replace(/^www\./u, '')
}

function hostnameSql(expression: string): string {
  const withoutScheme = `replace(replace(lower(coalesce(${expression},'')),'https://',''),'http://','')`
  return `substr(${withoutScheme},1,min(instr(${withoutScheme} || '/','/'),instr(${withoutScheme} || '?','?'),instr(${withoutScheme} || '#','#'))-1)`
}

export const learningSearchTextSql = `coalesce(json_extract(learning.details_json,'$.takeaway'),'') || ' ' || coalesce((SELECT group_concat(coalesce(json_extract(annotation.value,'$.note'),'') || ' ' || coalesce(json_extract(annotation.value,'$.quote'),''),' ') FROM json_each(learning.details_json,'$.annotations') annotation),'') || ' ' || coalesce((SELECT group_concat(topic.value,' ') FROM json_each(learning.details_json,'$.collections') topic),'')`

export function librarySearch(query: string, filters: LibraryFilters, columns: { text: string; kind: string; time: string; source: string }): { where: string; parameters: (string | number)[] } {
  const terms = searchTerms(query)
  const conditions = terms.map(() => `instr(${normalizedSearchSql(columns.text)},?)>0`)
  const parameters: (string | number)[] = [...terms]
  if (filters.kind === 'manual_note') conditions.push(`${columns.kind} IN ('manual_note','pasted_text')`)
  else if (filters.kind !== 'all') { conditions.push(`${columns.kind}=?`); parameters.push(filters.kind) }
  if (filters.sinceMs !== null) { conditions.push(`${columns.time}>=?`); parameters.push(filters.sinceMs) }
  if (filters.collection) {
    conditions.push(`EXISTS(SELECT 1 FROM json_each(learning.details_json,'$.collections') topic WHERE ${normalizedSearchSql('topic.value')}=?)`)
    parameters.push(normalizedSearchText(filters.collection))
  }
  if (filters.revisitOnly) conditions.push(`json_extract(learning.details_json,'$.revisit')=1`)
  if (filters.source) {
    const host = sourceHostname(filters.source)
    conditions.push(`(${hostnameSql(columns.source)}=? OR ${hostnameSql(columns.source)} GLOB ?)`)
    parameters.push(host, `*.${host}`)
  }
  return { where: conditions.length ? conditions.join(' AND ') : '1=1', parameters }
}
