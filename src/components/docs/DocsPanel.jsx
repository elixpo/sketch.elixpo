'use client'

import { useEffect, useRef, useState } from 'react'
import useSketchStore from '@/store/useSketchStore'
import useUIStore from '@/store/useUIStore'
import useDocAutoSave, { triggerDocSync } from '@/hooks/useDocAutoSave'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
// KaTeX CSS — until @elixpo/lixeditor republishes with KaTeX bundled
// inline, we have to import it consumer-side or block equations won't
// render. Safe to leave even after package republish (idempotent).
import 'katex/dist/katex.min.css'
import '@elixpo/lixeditor/styles'
import './docs-theme.css'
import { LixEditor, LixThemeProvider } from '@elixpo/lixeditor'
import {
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  SideMenuController,
  useBlockNoteEditor,
  useExtension,
  useExtensionState,
} from '@blocknote/react'
import { SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions'
import { flip, offset, shift } from '@floating-ui/react'
import { compressImage } from '@elixpo/lixsketch/src/utils/imageCompressor.js'
import { WORKER_URL } from '@/lib/env'
import { showToast } from '@/utils/toast'
import {
  DOC_CANVAS_LINKS_EVENT,
  FOCUS_DOC_BLOCK_EVENT,
  focusCanvasShape,
  getSelectedCanvasShape,
  getShapeLinkedToBlock,
  linkShapeToBlock,
  pruneDocCanvasLinks,
  unlinkBlock,
} from '@/utils/docCanvasLinks'

const DOC_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const DOC_IMAGE_MAX_BYTES = 5 * 1024 * 1024

const DOC_FORMATTING_TOOLBAR_OPTIONS = {
  useFloatingOptions: {
    placement: 'bottom-start',
    middleware: [offset(4), shift({ padding: 8 }), flip({ padding: 8 })],
  },
}

const DOC_SIDE_MENU_OPTIONS = {
  useFloatingOptions: {
    // The side menu uses `left-start`; a negative main-axis offset moves the
    // controls inward so they do not sit flush against the docs-pane edge.
    middleware: [offset(-12)],
  },
}

function DocumentFormattingToolbar() {
  return (
    <div className="lix-doc-formatting-toolbar">
      <FormattingToolbar>
        {getFormattingToolbarItems().filter((item) => {
          const key = item?.key ?? item?.props?.key
          return key !== 'createLink'
        })}
      </FormattingToolbar>
    </div>
  )
}

function DocumentBlockSideMenu() {
  const editor = useBlockNoteEditor()
  const sideMenu = useExtension(SideMenuExtension)
  const suggestionMenu = useExtension(SuggestionMenu)
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  })
  const [open, setOpen] = useState(false)
  const [, setLinkRevision] = useState(0)
  const menuRef = useRef(null)

  useEffect(() => {
    const refresh = () => setLinkRevision((revision) => revision + 1)
    window.addEventListener(DOC_CANVAS_LINKS_EVENT, refresh)
    return () => window.removeEventListener(DOC_CANVAS_LINKS_EVENT, refresh)
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [block?.id])

  useEffect(() => {
    if (!open) return undefined
    sideMenu.freezeMenu()
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return
      if (event.type === 'pointerdown' && menuRef.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', close, true)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', close, true)
      sideMenu.unfreezeMenu()
    }
  }, [open, sideMenu])

  if (!block) return null

  const linkedShape = getShapeLinkedToBlock(block.id)
  const selectedShape = open ? getSelectedCanvasShape() : null

  const openContextMenu = (event) => {
    event.preventDefault()
    setOpen(true)
  }
  const openContextMenuFromKeyboard = (event) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    openContextMenu(event)
  }
  const addBlock = () => {
    const isEmpty = Array.isArray(block.content) && block.content.length === 0
    const target = isEmpty
      ? block
      : editor.insertBlocks([{ type: 'paragraph', content: [] }], block, 'after')[0]
    editor.setTextCursorPosition(target, 'start')
    setOpen(false)
    requestAnimationFrame(() => suggestionMenu.openSuggestionMenu('/'))
  }
  const deleteBlock = () => {
    unlinkBlock(block.id)
    setOpen(false)
    editor.removeBlocks([block])
    requestAnimationFrame(() => editor.focus())
  }
  const linkSelectedShape = () => {
    if (!selectedShape) return
    linkShapeToBlock(selectedShape, block.id)
    setOpen(false)
    showToast('Shape linked to document block', { tone: 'success', duration: 1800 })
  }
  const removeLink = () => {
    unlinkBlock(block.id)
    setOpen(false)
    showToast('Canvas link removed', { duration: 1600 })
  }

  return (
    <div ref={menuRef} className="bn-side-menu lix-doc-block-side-menu" role="group" aria-label="Block actions">
      <button
        type="button"
        className="lix-doc-block-handle"
        title="Add block · right-click for block actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={addBlock}
        onContextMenu={openContextMenu}
        onKeyDown={openContextMenuFromKeyboard}
      >
        <i className="bx bx-plus text-xl" />
      </button>
      <button
        type="button"
        className="lix-doc-block-handle"
        title="Drag to move · right-click for block actions"
        aria-haspopup="menu"
        aria-expanded={open}
        draggable
        onDragStart={(event) => sideMenu.blockDragStart(event, block)}
        onDragEnd={sideMenu.blockDragEnd}
        onContextMenu={openContextMenu}
        onKeyDown={openContextMenuFromKeyboard}
      >
        <i className="bx bx-grid-vertical text-lg" />
      </button>
      {linkedShape && (
        <button
          type="button"
          className="lix-doc-block-handle lix-doc-link-handle"
          title="Open linked canvas shape"
          aria-label="Open linked canvas shape"
          onClick={() => focusCanvasShape(linkedShape.shapeID)}
        >
          <i className="bx bx-link text-sm" />
        </button>
      )}
      {open && (
        <div className="lix-doc-block-context" role="menu">
          <button type="button" role="menuitem" onClick={addBlock}>
            <i className="bx bx-plus-circle" />
            <span>Add block</span>
          </button>
          <button type="button" role="menuitem" disabled={!selectedShape} onClick={linkSelectedShape}>
            <i className="bx bx-link" />
            <span>{linkedShape ? 'Relink selected shape' : 'Link selected shape'}</span>
          </button>
          {!selectedShape && !linkedShape && (
            <p className="lix-doc-block-context-hint">Select one canvas shape first</p>
          )}
          {linkedShape && (
            <>
              <button type="button" role="menuitem" onClick={() => {
                setOpen(false)
                focusCanvasShape(linkedShape.shapeID)
              }}>
                <i className="bx bx-target-lock" />
                <span>Go to linked shape</span>
              </button>
              <button type="button" role="menuitem" onClick={removeLink}>
                <i className="bx bx-unlink" />
                <span>Remove canvas link</span>
              </button>
            </>
          )}
          <button type="button" role="menuitem" className="danger" onClick={deleteBlock}>
            <i className="bx bx-trash" />
            <span>Delete block</span>
          </button>
        </div>
      )}
    </div>
  )
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Could not read image'))
    reader.readAsDataURL(file)
  })
}

function validateRemoteImage(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      resolve(false)
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      resolve(false)
      return
    }

    const image = new Image()
    let settled = false
    const finish = (valid) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      image.onload = null
      image.onerror = null
      resolve(valid)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0)
    image.onerror = () => finish(false)
    image.src = parsed.href
  })
}

async function uploadDocumentImage(file) {
  const dataUrl = await readFileAsDataURL(file)
  const compressed = await compressImage(dataUrl)
  const sessionId = window.__sessionID
  const workerUrl = window.__WORKER_URL || WORKER_URL

  // Offline/local fallback: retain the compressed image without exposing the
  // package's default Embed URL card.
  if (!workerUrl || !sessionId) return compressed.dataUrl

  const signResponse = await fetch(`${workerUrl}/api/images/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      filename: `doc_${Date.now()}`,
    }),
  })
  if (!signResponse.ok) throw new Error('Could not authorize document image upload')
  const signData = await signResponse.json()

  const formData = new FormData()
  formData.append('file', compressed.blob)
  formData.append('api_key', signData.apiKey)
  formData.append('timestamp', String(signData.timestamp))
  formData.append('signature', signData.signature)
  formData.append('folder', signData.folder)
  formData.append('public_id', signData.publicId)

  const uploadResponse = await fetch(
    `https://api.cloudinary.com/v1_1/${signData.cloudName}/image/upload`,
    { method: 'POST', body: formData },
  )
  if (!uploadResponse.ok) throw new Error('Document image upload failed')
  const uploaded = await uploadResponse.json()
  const imageUrl = uploaded.secure_url || uploaded.url
  if (!imageUrl) throw new Error('Document image upload returned no URL')
  return imageUrl
}

function DocsLoading() {
  return (
    <div className="w-full h-full flex items-center justify-center text-text-dim text-xs font-[lixFont]">
      <i className="bx bx-loader-alt animate-spin mr-2" /> Loading editor…
    </div>
  )
}

export default function DocsPanel() {
  const layoutMode = useSketchStore((s) => s.layoutMode)
  const visible = layoutMode === 'split' || layoutMode === 'docs'
  const editorRef = useRef(null)
  const docHostRef = useRef(null)
  const focusedForDocsRef = useRef(false)
  const [editorReady, setEditorReady] = useState(false)
  // Controlled-mode theme: pass the canvas theme straight through to the
  // editor. Available since @elixpo/lixeditor@2.6.7 — replaces the prior
  // `defaultTheme` + manual `localStorage.setItem` workaround that was
  // needed because the storage-overrides-default precedence pinned the
  // editor to whatever theme was saved in a previous session.
  const canvasTheme = useUIStore((s) => s.theme)
  const docTheme = canvasTheme === 'dark' ? 'dark' : 'light'

  const { initialContent, ready } = useDocAutoSave(visible)

  useEffect(() => {
    if (!visible) setEditorReady(false)
  }, [visible])

  useEffect(() => {
    const focusBlock = (blockId) => {
      const editor = editorRef.current?.getEditor?.()
      if (!editor || !blockId) {
        window.__pendingDocBlockFocus = blockId
        return
      }
      const block = editor.getBlock?.(blockId)
      if (!block) return
      window.__pendingDocBlockFocus = null
      editor.setTextCursorPosition(block, 'start')
      editor.focus()
      requestAnimationFrame(() => {
        const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(blockId) : blockId
        docHostRef.current?.querySelector(`[data-id="${escapedId}"]`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      })
    }
    const handleFocusBlock = (event) => focusBlock(event.detail?.blockId)
    window.addEventListener(FOCUS_DOC_BLOCK_EVENT, handleFocusBlock)
    if (visible && editorReady && window.__pendingDocBlockFocus) {
      focusBlock(window.__pendingDocBlockFocus)
    }
    return () => window.removeEventListener(FOCUS_DOC_BLOCK_EVENT, handleFocusBlock)
  }, [editorReady, visible])

  useEffect(() => {
    const host = docHostRef.current
    if (!host) return undefined

    const submitEmbed = async (button, input) => {
      if (!button || !input || button.dataset.lixValidating === 'true') return
      button.dataset.lixValidating = 'true'
      const url = input.value.trim()
      const valid = await validateRemoteImage(url)
      delete button.dataset.lixValidating

      if (!valid) {
        showToast('Image URL could not be loaded', { tone: 'warn', duration: 2200 })
        input.focus()
        return
      }

      // Allow exactly one validated event through to LixEditor's handler.
      button.dataset.lixValidated = 'true'
      button.click()
    }

    const handleClick = (event) => {
      const button = event.target.closest?.('.blog-img-submit-btn')
      if (!button || !host.contains(button)) return
      if (button.dataset.lixValidated === 'true') {
        delete button.dataset.lixValidated
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const input = button.closest('.blog-img-input-row')?.querySelector('.blog-img-url-input')
      submitEmbed(button, input)
    }

    const handleKeyDown = (event) => {
      if (event.key !== 'Enter') return
      const input = event.target.closest?.('.blog-img-url-input')
      if (!input || !host.contains(input)) return
      event.preventDefault()
      event.stopPropagation()
      const button = input.closest('.blog-img-input-row')?.querySelector('.blog-img-submit-btn')
      submitEmbed(button, input)
    }

    host.addEventListener('click', handleClick, true)
    host.addEventListener('keydown', handleKeyDown, true)
    return () => {
      host.removeEventListener('click', handleClick, true)
      host.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [visible])

  useEffect(() => {
    if (layoutMode !== 'docs') {
      focusedForDocsRef.current = false
      return undefined
    }
    if (!ready || !editorReady || focusedForDocsRef.current) return undefined

    focusedForDocsRef.current = true
    const frameId = requestAnimationFrame(() => {
      const editor = editorRef.current?.getEditor?.()
      if (!editor) {
        focusedForDocsRef.current = false
        return
      }

      try {
        const documentBlocks = editor.document || []
        let target = documentBlocks[documentBlocks.length - 1]
        const content = target?.content
        const hasContent = Array.isArray(content)
          ? content.some((item) => typeof item === 'string' ? item.length > 0 : Boolean(item?.text || item?.content?.length))
          : Boolean(content)

        if (!target || target.type !== 'paragraph' || hasContent) {
          const inserted = target
            ? editor.insertBlocks([{ type: 'paragraph', content: [] }], target, 'after')
            : []
          target = inserted?.[0] || editor.document?.[editor.document.length - 1]
        }

        if (target) editor.setTextCursorPosition(target.id || target, 'end')
        editor.focus()
      } catch (error) {
        console.warn('[DocsPanel] Could not focus a new document line:', error)
      }
    })

    return () => cancelAnimationFrame(frameId)
  }, [editorReady, layoutMode, ready])

  if (!visible) return null

  return (
    <div className="w-full h-full bg-surface-dark overflow-hidden flex flex-col lix-sketch-theme">
      <div ref={docHostRef} className="flex-1 min-h-0 overflow-y-auto lix-editor-host">
        {ready ? (
          <LixThemeProvider theme={docTheme}>
            <LixEditor
              ref={editorRef}
              initialContent={initialContent}
              onReady={() => setEditorReady(true)}
              onChange={(editor) => {
                try {
                  const blocks = editor.document
                  pruneDocCanvasLinks(blocks)
                  triggerDocSync(blocks)
                } catch {}
              }}
              features={{ equations: true, mermaid: true, code: true }}
              uploadFile={uploadDocumentImage}
              acceptImageTypes={DOC_IMAGE_TYPES}
              maxFileSizeBytes={DOC_IMAGE_MAX_BYTES}
            >
              <FormattingToolbarController
                formattingToolbar={DocumentFormattingToolbar}
                floatingUIOptions={DOC_FORMATTING_TOOLBAR_OPTIONS}
              />
              <SideMenuController
                sideMenu={DocumentBlockSideMenu}
                floatingUIOptions={DOC_SIDE_MENU_OPTIONS}
              />
            </LixEditor>
          </LixThemeProvider>
        ) : (
          <DocsLoading />
        )}
      </div>
    </div>
  )
}
