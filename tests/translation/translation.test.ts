import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  downloadedTranslationModels: vi.fn(),
  downloadTranslationModel: vi.fn(),
  translationModelDownloadStates: vi.fn(),
  deleteTranslationModel: vi.fn(),
  translateText: vi.fn()
}))

vi.mock('../../modules/kestrel-source-processing', () => ({ default: native }))
vi.mock('react-native', () => ({ PermissionsAndroid: {}, Platform: { OS: 'web', Version: 0 } }))

import { downloadTranslationModel, installedTranslationModels, translateReading, translationModelDownloadStates } from '../../src/translation/translation'

describe('on-device translation boundary', () => {
  beforeEach(() => {
    native.downloadedTranslationModels.mockReset()
    native.downloadTranslationModel.mockReset()
    native.translationModelDownloadStates.mockReset()
    native.translateText.mockReset()
  })

  it('keeps only supported downloaded language models', async () => {
    native.downloadedTranslationModels.mockResolvedValue(['ar', 'en', 'unsupported'])
    await expect(installedTranslationModels()).resolves.toEqual(['ar', 'en'])
  })

  it('validates background language-pack states', async () => {
    native.translationModelDownloadStates.mockResolvedValue([{ language: 'de', state: 'downloading', error: null }])
    await expect(translationModelDownloadStates()).resolves.toEqual([{ language: 'de', state: 'downloading', error: null }])
  })

  it('does not enqueue a language pack that is already installed', async () => {
    native.downloadedTranslationModels.mockResolvedValue(['fr'])
    await downloadTranslationModel('fr')
    expect(native.downloadTranslationModel).not.toHaveBeenCalled()
  })

  it('turns a missing source-language model rejection into user guidance', async () => {
    native.translateText.mockRejectedValue(new Error("Call to function 'KestrelSourceProcessing.translateText' has been rejected. Caused by: java.lang.IllegalArgumentException: Download the ar translation pack first"))
    await expect(translateReading('ملاحظة عربية', 'en')).rejects.toThrow('Arabic is needed to read this note. Download it from Settings → Language packs.')
  })

  it('bounds long source text without splitting UTF-8 before native translation', async () => {
    native.translateText.mockImplementation(async (text: string) => ({ sourceLanguage: 'en', text }))
    const result = await translateReading(`${'a'.repeat(65_534)}😀more`, 'ar')
    const submitted = native.translateText.mock.calls[0][0] as string
    expect(new TextEncoder().encode(submitted).byteLength).toBeLessThanOrEqual(64 * 1024)
    expect(submitted.endsWith('\ud83d')).toBe(false)
    expect(result.truncated).toBe(true)
  })
})
