import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { chooseFile } from '../../capture/chooseFile'
import { prepareFacebookVideo } from '../../transcription/facebookVideo'
import { discardTemporaryAudio, type AudioCandidate } from '../../transcription/transcription'
import { videoRecoveryCopy } from './videoRecoveryCopy'
import { videoRecoveryErrorMessage } from './videoRecoveryError'
import { sourceForTranscription } from '../../transcription/saveTranscript'
import type { NavigationTab } from '../../types'

export function useVideoRecovery({ context, selected, notice }: { readonly context: NavigationTab; readonly selected: (audio: AudioCandidate) => void; readonly notice: (message: string) => void }) {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)
  const [choosingFile, setChoosingFile] = useState(false)
  const active = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const picking = useRef(false)
  const generation = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; active.current?.abort() } }, [])
  const report = (key: 'failed' | 'fileFailed', error: unknown) => { const reason = videoRecoveryErrorMessage(error); notice(`${videoRecoveryCopy(key)}${reason ? ` ${reason}` : ''}`) }
  const invalidate = useCallback(() => { generation.current += 1; active.current?.abort() }, [])
  const cancel = useCallback(() => { invalidate(); active.current = null; setPendingUrl(null) }, [invalidate])
  useLayoutEffect(() => { if (context !== 'library') invalidate() }, [context, invalidate])
  const transcribe = (url: string, captureId?: string) => {
    if (active.current || picking.current) return
    const controller = new AbortController()
    const request = ++generation.current
    active.current = controller
    setPendingUrl(url)
    void sourceForTranscription(captureId, url).then(async origin => {
      const audio = await prepareFacebookVideo(url, controller.signal)
      return { ...audio, origin: { ...origin, title: origin.title ?? audio.origin?.title, thumbnailUrl: audio.origin?.thumbnailUrl ?? origin.thumbnailUrl } }
    }).then(audio => {
      if (mounted.current && request === generation.current && !controller.signal.aborted) selected(audio)
      else discardTemporaryAudio(audio)
    }).catch(error => { if (mounted.current && request === generation.current && !controller.signal.aborted) report('failed', error) })
      .finally(() => { if (mounted.current && active.current === controller) { active.current = null; setPendingUrl(null) } })
  }
  const choose = (url?: string, captureId?: string) => {
    if (active.current || picking.current) return
    picking.current = true
    const request = ++generation.current
    setChoosingFile(true)
    const origin = url ? sourceForTranscription(captureId, url) : Promise.resolve(undefined)
    void origin.then(async source => {
      if (!mounted.current || request !== generation.current) return null
      const file = await chooseFile('video')
      return file?.kind === 'audio' ? { ...file, audio: { ...file.audio, ...(source ? { origin: source } : {}) } } : file
    }).then(file => {
      if (file?.kind !== 'audio') return
      if (mounted.current && request === generation.current) selected(file.audio)
      else discardTemporaryAudio(file.audio)
    }).catch(error => { if (mounted.current && request === generation.current) report('fileFailed', error) })
      .finally(() => { picking.current = false; if (mounted.current) setChoosingFile(false) })
  }
  return { pendingUrl, choosingFile, transcribe, choose, cancel, invalidate }
}
