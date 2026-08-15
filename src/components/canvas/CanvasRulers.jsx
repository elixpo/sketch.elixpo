"use client"

import { useEffect, useMemo, useState } from 'react'

const GRID_SIZE = 20
const MIN_LABEL_GAP = 52
const RULER_SIZE = 26

function getRulerStep(zoom) {
  const requiredMultiple = MIN_LABEL_GAP / Math.max(zoom * GRID_SIZE, 0.001)
  const power = 10 ** Math.floor(Math.log10(Math.max(1, requiredMultiple)))
  for (const factor of [1, 2, 5, 10]) {
    const multiple = factor * power
    if (multiple >= requiredMultiple) return GRID_SIZE * multiple
  }
  return GRID_SIZE
}

function formatDimension(value) {
  const rounded = Math.round(value)
  const absolute = Math.abs(rounded)
  if (absolute >= 1000000) return `${Number((rounded / 1000000).toFixed(1))}m`
  if (absolute >= 10000) return `${Number((rounded / 1000).toFixed(1))}k`
  return String(rounded)
}

function buildTicks(start, extent, zoom, step) {
  const first = Math.floor(start / step) * step
  const last = start + extent / zoom
  const ticks = []
  for (let value = first; value <= last + step; value += step) {
    ticks.push({ value, position: (value - start) * zoom })
  }
  return ticks
}

export default function CanvasRulers({ enabled, svgRef }) {
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1, width: 0, height: 0 })

  useEffect(() => {
    if (!enabled) return undefined

    let frameId
    let previous = ''
    const sync = () => {
      const svg = svgRef.current
      if (svg) {
        const rect = svg.getBoundingClientRect()
        const viewBox = window.currentViewBox || svg.viewBox?.baseVal
        const zoom = Number(window.currentZoom) || (viewBox?.width ? rect.width / viewBox.width : 1)
        const next = {
          x: Number(viewBox?.x) || 0,
          y: Number(viewBox?.y) || 0,
          zoom: Math.max(0.001, zoom),
          width: rect.width,
          height: rect.height,
        }
        const signature = `${next.x}|${next.y}|${next.zoom}|${next.width}|${next.height}`
        if (signature !== previous) {
          previous = signature
          setViewport(next)
        }
      }
      frameId = requestAnimationFrame(sync)
    }

    frameId = requestAnimationFrame(sync)
    return () => cancelAnimationFrame(frameId)
  }, [enabled, svgRef])

  const step = useMemo(() => getRulerStep(viewport.zoom), [viewport.zoom])
  const horizontalTicks = useMemo(
    () => buildTicks(viewport.x, viewport.width, viewport.zoom, step),
    [viewport.x, viewport.width, viewport.zoom, step],
  )
  const verticalTicks = useMemo(
    () => buildTicks(viewport.y, viewport.height, viewport.zoom, step),
    [viewport.y, viewport.height, viewport.zoom, step],
  )

  if (!enabled) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-[900] select-none text-text-muted" aria-hidden="true">
      <div
        className="absolute inset-x-0 top-0 overflow-hidden border-b border-border-light bg-surface/95 shadow-sm backdrop-blur-sm"
        style={{ height: RULER_SIZE }}
      >
        {horizontalTicks.map(({ value, position }) => (
          <div key={value} className="absolute bottom-0 h-2 border-l border-text-dim" style={{ left: position }}>
            <span className="absolute bottom-2 left-1 font-mono text-[9px] leading-none tabular-nums">
              {formatDimension(value)}
            </span>
          </div>
        ))}
      </div>
      <div
        className="absolute inset-y-0 left-0 overflow-hidden border-r border-border-light bg-surface/95 shadow-sm backdrop-blur-sm"
        style={{ width: RULER_SIZE }}
      >
        {verticalTicks.map(({ value, position }) => (
          <div key={value} className="absolute right-0 w-2 border-t border-text-dim" style={{ top: position }}>
            <span
              className="absolute right-2 top-1 font-mono text-[9px] leading-none tabular-nums"
              style={{ transform: 'rotate(-90deg)', transformOrigin: 'top right' }}
            >
              {formatDimension(value)}
            </span>
          </div>
        ))}
      </div>
      <div
        className="absolute left-0 top-0 border-b border-r border-border-light bg-accent/20"
        style={{ width: RULER_SIZE, height: RULER_SIZE }}
      >
        <span className="absolute left-1/2 top-1/2 h-2.5 -translate-x-1/2 -translate-y-1/2 border-l border-accent" />
        <span className="absolute left-1/2 top-1/2 w-2.5 -translate-x-1/2 -translate-y-1/2 border-t border-accent" />
      </div>
    </div>
  )
}
