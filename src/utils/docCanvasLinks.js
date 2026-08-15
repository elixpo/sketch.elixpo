import useSketchStore from '@/store/useSketchStore'
import useUIStore from '@/store/useUIStore'

export const DOC_CANVAS_LINKS_EVENT = 'lix-doc-canvas-links-changed'
export const FOCUS_DOC_BLOCK_EVENT = 'lix-focus-doc-block'

function shapes() {
  return Array.isArray(window.shapes) ? window.shapes : []
}

export function getShapeElement(shape) {
  return shape?.group || shape?.element || null
}

export function getSelectedCanvasShape() {
  if (typeof window === 'undefined') return null
  const selected = window.multiSelection?.selectedShapes
  if (selected?.size === 1) return Array.from(selected)[0]
  if (selected?.size > 1) return null
  return window.currentShape || null
}

export function getShapeById(shapeId) {
  if (!shapeId || typeof window === 'undefined') return null
  return shapes().find((shape) => shape?.shapeID === shapeId) || null
}

export function getShapeLinkedToBlock(blockId) {
  if (!blockId || typeof window === 'undefined') return null
  return shapes().find((shape) => shape?.docBlockId === blockId) || null
}

export function getLinkedShapes() {
  if (typeof window === 'undefined') return []
  return shapes().filter((shape) => shape?.shapeID && shape?.docBlockId)
}

export function emitDocCanvasLinksChanged() {
  if (typeof window === 'undefined') return
  useUIStore.getState().setSaveStatus('local')
  window.dispatchEvent(new CustomEvent(DOC_CANVAS_LINKS_EVENT))
}

export function linkShapeToBlock(shape, blockId) {
  if (!shape?.shapeID || !blockId) return false
  // Keep the relationship one-to-one. Relinking either endpoint replaces its
  // previous connection and leaves no ambiguous navigation target.
  for (const candidate of shapes()) {
    if (candidate !== shape && candidate.docBlockId === blockId) {
      delete candidate.docBlockId
      getShapeElement(candidate)?.removeAttribute('data-doc-block-id')
    }
  }
  shape.docBlockId = blockId
  getShapeElement(shape)?.setAttribute('data-doc-block-id', blockId)
  emitDocCanvasLinksChanged()
  window.__onLocalSave?.()
  return true
}

export function unlinkBlock(blockId) {
  const shape = getShapeLinkedToBlock(blockId)
  if (!shape) return false
  delete shape.docBlockId
  getShapeElement(shape)?.removeAttribute('data-doc-block-id')
  emitDocCanvasLinksChanged()
  window.__onLocalSave?.()
  return true
}

export function pruneDocCanvasLinks(documentBlocks) {
  if (!Array.isArray(documentBlocks) || typeof window === 'undefined') return
  const blockIds = new Set()
  const collect = (blocks) => {
    for (const block of blocks || []) {
      if (block?.id) blockIds.add(block.id)
      if (block?.children?.length) collect(block.children)
    }
  }
  collect(documentBlocks)
  let changed = false
  for (const shape of shapes()) {
    if (shape.docBlockId && !blockIds.has(shape.docBlockId)) {
      delete shape.docBlockId
      getShapeElement(shape)?.removeAttribute('data-doc-block-id')
      changed = true
    }
  }
  if (changed) emitDocCanvasLinksChanged()
}

function selectShape(shape) {
  if (!shape) return
  const current = window.currentShape
  if (current && current !== shape && typeof current.removeSelection === 'function') {
    current.removeSelection()
  }
  window.multiSelection?.clearSelection?.()
  window.currentShape = shape
  if (typeof shape.addAnchors === 'function') shape.addAnchors()
  else if (typeof shape.createSelection === 'function') shape.createSelection()
  else if (typeof shape.selectShape === 'function') shape.selectShape()
  else if (typeof shape.selectFrame === 'function') shape.selectFrame()
  shape.isSelected = true
  shape.updateSidebar?.()
}

export function focusCanvasShape(shapeId) {
  if (typeof window === 'undefined') return false
  const shape = getShapeById(shapeId)
  if (!shape) return false
  useSketchStore.getState().setLayoutMode('split')

  requestAnimationFrame(() => requestAnimationFrame(() => {
    const svg = window.svg || document.getElementById('freehand-canvas')
    const element = getShapeElement(shape)
    if (!svg || !element) return
    try {
      const bounds = element.getBBox()
      const viewBox = window.currentViewBox || svg.viewBox?.baseVal
      if (viewBox?.width && viewBox?.height) {
        const svgRect = svg.getBoundingClientRect()
        const paneRect = svg.parentElement?.getBoundingClientRect?.() || svgRect
        const visibleWidth = viewBox.width * Math.min(1, paneRect.width / Math.max(1, svgRect.width))
        const x = bounds.x + bounds.width / 2 - visibleWidth / 2
        const y = bounds.y + bounds.height / 2 - viewBox.height / 2
        window.currentViewBox = { x, y, width: viewBox.width, height: viewBox.height }
        svg.setAttribute('viewBox', `${x} ${y} ${viewBox.width} ${viewBox.height}`)
      }
      selectShape(shape)
    } catch {}
  }))
  return true
}

export function focusDocumentBlock(blockId) {
  if (!blockId || typeof window === 'undefined') return false
  window.__pendingDocBlockFocus = blockId
  useSketchStore.getState().setLayoutMode('split')
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent(FOCUS_DOC_BLOCK_EVENT, { detail: { blockId } }))
  }))
  return true
}
