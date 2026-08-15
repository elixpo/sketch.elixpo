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
} from '@blocknote/react'
import { flip, offset, shift } from '@floating-ui/react'
import { compressImage } from '@elixpo/lixsketch/src/utils/imageCompressor.js'
import { WORKER_URL } from '@/lib/env'

const DOC_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const DOC_IMAGE_MAX_BYTES = 5 * 1024 * 1024

const DOC_FORMATTING_TOOLBAR_OPTIONS = {
  useFloatingOptions: {
    placement: 'bottom-start',
    middleware: [offset(4), shift({ padding: 8 }), flip({ padding: 8 })],
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

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Could not read image'))
    reader.readAsDataURL(file)
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
      <div className="flex-1 min-h-0 overflow-y-auto lix-editor-host">
        {ready ? (
          <LixThemeProvider theme={docTheme}>
            <LixEditor
              ref={editorRef}
              initialContent={initialContent}
              onReady={() => setEditorReady(true)}
              onChange={(editor) => {
                try {
                  const blocks = editor.document
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
            </LixEditor>
          </LixThemeProvider>
        ) : (
          <DocsLoading />
        )}
      </div>
    </div>
  )
}
