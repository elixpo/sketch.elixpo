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
