'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DOC_CANVAS_LINKS_EVENT,
  focusDocumentBlock,
  getLinkedShapes,
  getShapeElement,
} from '@/utils/docCanvasLinks'

export default function CanvasDocConnectors() {
  const hostRef = useRef(null)
  const frameRef = useRef(null)
  const [connectors, setConnectors] = useState([])

  const update = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      const host = hostRef.current
      if (!host) return
      const hostRect = host.getBoundingClientRect()
      const next = []
      for (const shape of getLinkedShapes()) {
        const element = getShapeElement(shape)
        if (!element?.isConnected) continue
        const rect = element.getBoundingClientRect()
        if (rect.right < hostRect.left || rect.left > hostRect.right || rect.bottom < hostRect.top || rect.top > hostRect.bottom) continue
        next.push({
          shapeId: shape.shapeID,
          blockId: shape.docBlockId,
          left: Math.min(hostRect.width - 24, Math.max(0, rect.right - hostRect.left - 10)),
          top: Math.min(hostRect.height - 24, Math.max(0, rect.top - hostRect.top - 10)),
        })
      }
      setConnectors(next)
    })
  }, [])

  useEffect(() => {
    const svg = document.getElementById('freehand-canvas')
    update()
    window.addEventListener(DOC_CANVAS_LINKS_EVENT, update)
    window.addEventListener('resize', update)
    const observer = svg && typeof MutationObserver !== 'undefined'
      ? new MutationObserver(update)
      : null
    observer?.observe(svg, { attributes: true, childList: true, subtree: true })
    const fallback = window.setInterval(update, 1500)
    return () => {
      cancelAnimationFrame(frameRef.current)
      window.clearInterval(fallback)
      observer?.disconnect()
      window.removeEventListener(DOC_CANVAS_LINKS_EVENT, update)
      window.removeEventListener('resize', update)
    }
  }, [update])

  return (
    <div ref={hostRef} className="absolute inset-0 z-20 pointer-events-none overflow-hidden" aria-hidden={connectors.length === 0}>
      {connectors.map((connector) => (
        <button
          key={connector.shapeId}
          type="button"
          className="absolute w-6 h-6 rounded-full border border-accent/50 bg-surface-card/95 text-accent shadow-lg shadow-black/25 backdrop-blur flex items-center justify-center pointer-events-auto cursor-pointer hover:bg-accent hover:text-white transition-colors"
          style={{ left: connector.left, top: connector.top }}
          title="Open linked document block"
          aria-label="Open linked document block"
          onClick={(event) => {
            event.stopPropagation()
            focusDocumentBlock(connector.blockId)
          }}
        >
          <i className="bx bx-link text-sm" />
        </button>
      ))}
    </div>
  )
}
