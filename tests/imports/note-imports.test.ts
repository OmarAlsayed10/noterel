import { beforeEach, describe, expect, it, vi } from 'vitest'

const boundaries = vi.hoisted(() => ({ readNoteImport: vi.fn(), restorePhoneOnlyCaptures: vi.fn() }))

vi.mock('../../modules/kestrel-source-processing', () => ({ default: { readNoteImport: boundaries.readNoteImport } }))
vi.mock('../../src/capture/outbox', () => ({ restorePhoneOnlyCaptures: boundaries.restorePhoneOnlyCaptures }))

import { readNoteImport, saveNoteImport } from '../../src/imports/noteImports'

describe('external note imports', () => {
  beforeEach(() => {
    boundaries.readNoteImport.mockReset()
    boundaries.restorePhoneOnlyCaptures.mockReset()
  })

  it('normalizes archive notes before presenting a preview', async () => {
    boundaries.readNoteImport.mockResolvedValue({ kind: 'archive', notes: [{ title: ' First ', text: ' Body ', sourcePath: 'vault/First.md' }] })
    const candidate = await readNoteImport('file:///archive.zip', 'archive.zip', 1200)
    expect(candidate.notes).toEqual([{ kind: 'note', title: 'First', text: 'Body' }])
    expect(candidate.sourcePaths).toEqual(['vault/First.md'])
  })

  it('rejects archives over the declared boundary before native parsing', async () => {
    await expect(readNoteImport('file:///archive.zip', 'archive.zip', 64 * 1024 * 1024 + 1)).rejects.toThrow('64 MiB')
    expect(boundaries.readNoteImport).not.toHaveBeenCalled()
  })

  it('saves the approved preview through one encrypted bulk transaction boundary', async () => {
    boundaries.restorePhoneOnlyCaptures.mockResolvedValue(1)
    const candidate = { filename: 'notes.zip', kind: 'archive' as const, notes: [{ kind: 'note' as const, title: 'One', text: 'Text' }], sourcePaths: ['One.md'] }
    await expect(saveNoteImport(candidate)).resolves.toBe(1)
    expect(boundaries.restorePhoneOnlyCaptures).toHaveBeenCalledWith(candidate.notes)
  })
})
