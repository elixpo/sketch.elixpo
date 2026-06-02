"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import useUIStore from '@/store/useUIStore'

/**
 * Combined DSL / Mermaid / Graph modal. Replaces the old AI placeholder.
 * Each tab dispatches to a different engine bridge that's set up at
 * engine.init() — no inference, just direct client-side parsing.
 *
 *   DSL     → window.__lixscriptExecute(src)
 *   Mermaid → window.__mermaidRenderer(src)
 *   Graph   → window.__graphRenderer(equations, settings)
 */

const TABS = [
  { id: 'dsl',     label: 'LixScript', icon: 'bx-code-alt' },
  { id: 'mermaid', label: 'Mermaid',   icon: 'bx-shape-polygon' },
  { id: 'graph',   label: 'Graph',     icon: 'bx-line-chart' },
]

const SAMPLES = {
  dsl: `# LixScript — write shapes and arrows in a tiny DSL.
# Cmd/Ctrl+Enter to render.

rect A "Idea" 100 100 220 90
rect B "Plan" 400 100 220 90
rect C "Ship" 700 100 220 90

arrow A -> B
arrow B -> C
`,
  mermaid: `flowchart TD
    A[Start] --> B{Decide}
    B -->|Yes| C[Do it]
    B -->|No| D[Skip]
    C --> E[End]
    D --> E
`,
  graph: `# One equation per line. Comments start with #.
y = x^2
y = sin(x) * 3
y = -x + 2
`,
}

const DEFAULT_GRAPH_RANGE = { xMin: -10, xMax: 10, yMin: -10, yMax: 10, showGrid: true }

function parseEquations(text) {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'))
}

export default function AIModal() {
  const aiModalOpen = useUIStore((s) => s.aiModalOpen)
  const toggleAIModal = useUIStore((s) => s.toggleAIModal)

  const [active, setActive] = useState('dsl')
  const [sources, setSources] = useState(() => ({ ...SAMPLES }))
  const [range, setRange] = useState(DEFAULT_GRAPH_RANGE)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null) // { tone: 'success'|'error', message }
  const taRef = useRef(null)

  // Focus the textarea + bind Esc when the modal opens / tab switches.
  useEffect(() => {
    if (!aiModalOpen) return
    requestAnimationFrame(() => taRef.current?.focus())
    const onKey = (e) => { if (e.key === 'Escape') toggleAIModal() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [aiModalOpen, active, toggleAIModal])

  // Reset transient feedback when changing tabs.
  useEffect(() => { setStatus(null) }, [active])

  const updateSource = (val) => setSources((prev) => ({ ...prev, [active]: val }))
  const setRangeKey = (key) => (e) => {
    const v = parseFloat(e.target.value)
    if (Number.isFinite(v)) setRange((s) => ({ ...s, [key]: v }))
  }

  const render = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setStatus(null)
    try {
      const src = sources[active] || ''
      if (active === 'dsl') {
        const fn = window.__lixscriptExecute
        if (typeof fn !== 'function') throw new Error('LixScript engine not ready.')
        const result = fn(src)
        const ok = result == null || result === true || (result && result.ok !== false)
        if (!ok) throw new Error(result?.error || 'LixScript parse failed.')
        setStatus({ tone: 'success', message: 'Rendered to canvas.' })
      } else if (active === 'mermaid') {
        const fn = window.__mermaidRenderer
        if (typeof fn !== 'function') throw new Error('Mermaid renderer not ready.')
        await fn(src)
        setStatus({ tone: 'success', message: 'Diagram rendered.' })
      } else if (active === 'graph') {
        const equations = parseEquations(src)
        if (equations.length === 0) throw new Error('Add at least one equation.')
        const validate = window.__graphValidate
        if (typeof validate === 'function') {
          const bad = equations.find((eq) => !validate(eq))
          if (bad) throw new Error(`Could not parse: ${bad}`)
        }
        const fn = window.__graphRenderer
        if (typeof fn !== 'function') throw new Error('Graph engine not ready.')
        fn(equations, range)
        setStatus({ tone: 'success', message: `Plotted ${equations.length} equation(s).` })
      }
      // Auto-close shortly after a successful render.
      setTimeout(() => { if (useUIStore.getState().aiModalOpen) toggleAIModal() }, 800)
    } catch (err) {
      console.warn('[AIModal] render failed:', err)
      setStatus({ tone: 'error', message: err?.message || 'Render failed.' })
    } finally {
      setBusy(false)
    }
  }, [active, sources, range, busy, toggleAIModal])

  const handleKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      render()
    }
  }, [render])

  if (!aiModalOpen) return null

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 backdrop-blur-sm font-[lixFont]"
      onClick={toggleAIModal}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-[640px] max-w-[94vw] bg-surface-dark border border-border-light rounded-2xl p-5 shadow-2xl flex flex-col gap-3"
      >
        <button
          onClick={toggleAIModal}
          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="Close (Esc)"
        >
          <i className="bx bx-x text-lg" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9b7bf7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
              <path d="M18 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-text-primary text-sm font-medium">DSL Studio</h2>
            <p className="text-text-dim text-[11px]">Write LixScript, Mermaid, or equations — rendered directly. No inference.</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-0.5 bg-surface rounded-lg w-fit">
          {TABS.map((tab) => {
            const isActive = active === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] transition-colors ${
                  isActive
                    ? 'bg-surface-active text-text-primary'
                    : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
                }`}
              >
                <i className={`bx ${tab.icon} text-base`} />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Source editor */}
        <textarea
          ref={taRef}
          value={sources[active]}
          onChange={(e) => updateSource(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="w-full h-[240px] resize-none bg-surface border border-border-light rounded-lg px-3 py-2 text-[12px] text-text-primary font-[lixCode] outline-none focus:border-accent/50"
        />

        {/* Graph-only axis controls */}
        {active === 'graph' && (
          <div className="grid grid-cols-4 gap-2 text-[11px]">
            {['xMin', 'xMax', 'yMin', 'yMax'].map((k) => (
              <label key={k} className="flex flex-col gap-0.5">
                <span className="text-text-dim">{k}</span>
                <input
                  type="number"
                  value={range[k]}
                  onChange={setRangeKey(k)}
                  className="bg-surface border border-border-light rounded px-2 py-1 text-text-primary outline-none focus:border-accent/50"
                />
              </label>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            {status ? (
              <span className={`text-[11px] ${status.tone === 'error' ? 'text-red-400' : 'text-green-400'}`}>
                {status.message}
              </span>
            ) : (
              <span className="text-text-dim text-[11px]">Cmd/Ctrl+Enter to render · Esc to close</span>
            )}
          </div>
          <button
            onClick={render}
            disabled={busy}
            className="px-3.5 py-1.5 rounded-lg bg-accent text-text-primary text-[12px] font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            {busy ? 'Rendering…' : 'Render'}
          </button>
        </div>
      </div>
    </div>
  )
}
