import { useState, useEffect, useCallback } from 'react'
import { useI18n } from '../lib/i18n'

export interface UpdaterState {
  phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'none'
  version: string
  progress: number
  dismiss: () => void
  install: () => void
}

const initial: UpdaterState = { phase: 'idle', version: '', progress: 0, dismiss: () => {}, install: () => {} }

export function useUpdater(): UpdaterState {
  const [state, setState] = useState<UpdaterState>(initial)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onUpdaterEvent) return

    const off = api.onUpdaterEvent((evt) => {
      setState(prev => {
        if (evt.type === 'checking') return { ...prev, phase: 'checking' }
        if (evt.type === 'available') return { ...prev, phase: 'downloading', version: evt.version || '', progress: 0 }
        if (evt.type === 'progress') return { ...prev, phase: 'downloading', progress: Math.round(evt.percent || 0) }
        if (evt.type === 'downloaded') return { ...prev, phase: 'ready', version: evt.version || prev.version }
        if (evt.type === 'none') return { ...prev, phase: 'none' }
        if (evt.type === 'error') return { ...prev, phase: 'error' }
        return prev
      })
    })
    return off
  }, [])

  const dismiss = useCallback(() => setState(prev => ({ ...prev, phase: 'idle' })), [])
  const install = useCallback(() => {
    window.electronAPI?.quitAndInstall()
  }, [])

  return { ...state, dismiss, install }
}

export function UpdateToast({ state }: { state: UpdaterState }) {
  const { t } = useI18n()

  // Auto-dismiss transient states: checking / up to date / error
  useEffect(() => {
    if (state.phase === 'checking' || state.phase === 'none' || state.phase === 'error') {
      const timer = setTimeout(state.dismiss, 4000)
      return () => clearTimeout(timer)
    }
  }, [state.phase, state.dismiss])

  if (state.phase === 'idle') return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-[300px] border border-phosphor/40 bg-panel/95 backdrop-blur shadow-[0_0_30px_rgba(0,244,142,0.15)] px-4 py-3 text-[12px]">
      {state.phase === 'checking' && (
        <div className="text-muted">{t.updateChecking}</div>
      )}
      {state.phase === 'none' && (
        <div className="text-phosphor">✓ {t.updateNone}</div>
      )}
      {state.phase === 'error' && (
        <div className="text-danger">✗ {t.updateError}</div>
      )}
      {state.phase === 'downloading' && (
        <div>
          <div className="text-bright mb-1.5">{t.updateProgress(state.progress)}</div>
          <div className="h-1 bg-panel-2 border border-line-soft overflow-hidden">
            <div
              className="h-full bg-phosphor transition-all duration-300"
              style={{ width: `${state.progress}%` }}
            />
          </div>
        </div>
      )}
      {state.phase === 'ready' && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-phosphor">⬆ {t.updateReady(state.version)}</span>
          <span className="flex gap-1.5 shrink-0">
            <button
              onClick={state.dismiss}
              className="text-muted border border-line-soft px-2 py-0.5 hover:text-bright transition-colors"
            >
              {t.updateLater}
            </button>
            <button
              onClick={state.install}
              className="text-terminal bg-phosphor border border-phosphor px-2 py-0.5 font-semibold hover:bg-phosphor-glow transition-colors"
            >
              {t.updateRestart}
            </button>
          </span>
        </div>
      )}
    </div>
  )
}
