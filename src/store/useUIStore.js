import { create } from 'zustand'
import useSketchStore from '@/store/useSketchStore'
import {
  isTheme,
  readCanvasTheme,
  readUITheme,
  resolveThemeValue,
  writeCanvasTheme,
  writeUITheme,
} from '@/utils/themePreferences'

export const MAX_WORKSPACE_NAME_LENGTH = 20

function limitWorkspaceName(name) {
  return String(name ?? '').slice(0, MAX_WORKSPACE_NAME_LENGTH)
}

function prefersDark() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Resolve a stored theme ('light' | 'dark' | 'system') to 'light' | 'dark'. */
export function resolveTheme(theme) {
  return resolveThemeValue(theme, theme === 'system' && prefersDark())
}

function browserStorage() {
  if (typeof window === 'undefined') return null
  try { return window.localStorage } catch { return null }
}

function themeColor(value, resolved) {
  if (!value || typeof value !== 'string') return value
  const normalized = value.toLowerCase().trim()
  if (['#e0e0e0', '#e8e3f3'].includes(normalized)) {
    return resolved === 'light' ? '#000000' : '#ffffff'
  }
  if (resolved === 'dark' && ['#000', '#000000', 'black', '#1a1a2e'].includes(normalized)) {
    return '#ffffff'
  }
  if (resolved === 'light' && ['#fff', '#ffffff', 'white'].includes(normalized)) {
    return '#000000'
  }
  return value
}

/** Normalize serialized theme-default colors before constructors draw them. */
export function normalizeSceneColorsForTheme(sceneData, resolved) {
  if (!Array.isArray(sceneData?.shapes)) return sceneData
  for (const shape of sceneData.shapes) {
    shape.labelColor = themeColor(shape.labelColor, resolved)
    if (shape.options) {
      shape.options.stroke = themeColor(shape.options.stroke, resolved)
      shape.options.fill = themeColor(shape.options.fill, resolved)
      shape.options.labelColor = themeColor(shape.options.labelColor, resolved)
    }
    for (const htmlKey of ['groupHTML', 'elementHTML']) {
      if (typeof shape[htmlKey] !== 'string') continue
      shape[htmlKey] = shape[htmlKey].replace(
        /\b(fill|stroke)=(['"])(#fff(?:fff)?|white|#000(?:000)?|black|#1a1a2e)\2/gi,
        (match, attribute, quote, color) => `${attribute}=${quote}${themeColor(color, resolved)}${quote}`,
      )
    }
  }
  return sceneData
}

/**
 * Swap black↔white colors on all shapes when theme changes.
 * prevTheme / nextTheme are resolved ('dark' | 'light').
 */
function invertShapeColors(prevResolved, nextResolved) {
  if (prevResolved === nextResolved) return
  const shapes = window.shapes
  if (!shapes || shapes.length === 0) return

  // Light tools now use pure black, while older scenes may use near-black.
  // Treat both as theme-owned colors so existing strokes do not
  // disappear when the canvas changes underneath them.
  const fromColors = nextResolved === 'light'
    ? new Set(['#ffffff'])
    : new Set(['#000000', '#1a1a2e'])
  const to = nextResolved === 'light' ? '#000000' : '#ffffff'

  const normalize = (c) => {
    if (!c || c === 'transparent' || c === 'none') return c
    const lower = c.toLowerCase().trim()
    if (lower === '#fff' || lower === '#ffffff' || lower === 'white') return '#ffffff'
    if (lower === '#000' || lower === '#000000' || lower === 'black') return '#000000'
    return lower
  }

  for (const shape of shapes) {
    let changed = false
    if (shape.shapeName === 'icon' || shape.type === 'icon') {
      const isDark = nextResolved === 'dark'
      const targetDarkColor = '#1a1a2e'
      const bgDarkColor = '#15111f'

      if (shape.group) {
        shape.group.querySelectorAll('*').forEach((element) => {
          if (element.nodeType === 1) {
            const fill = element.getAttribute('fill')
            const stroke = element.getAttribute('stroke')

            if (fill && fill !== 'none' && fill !== 'transparent') {
              const normFill = fill.toLowerCase().trim()
              if (isDark) {
                if (normFill === targetDarkColor || normFill === '#000000' || normFill === '#000') {
                  element.setAttribute('fill', '#ffffff')
                  changed = true
                } else if (normFill === '#ffffff' || normFill === '#fff') {
                  element.setAttribute('fill', bgDarkColor)
                  changed = true
                }
              } else {
                if (normFill === '#ffffff' || normFill === '#fff') {
                  element.setAttribute('fill', targetDarkColor)
                  changed = true
                } else if (normFill === bgDarkColor) {
                  element.setAttribute('fill', '#ffffff')
                  changed = true
                }
              }
            }

            if (stroke && stroke !== 'none' && stroke !== 'transparent') {
              const normStroke = stroke.toLowerCase().trim()
              if (isDark) {
                if (normStroke === targetDarkColor || normStroke === '#000000' || normStroke === '#000') {
                  element.setAttribute('stroke', '#ffffff')
                  changed = true
                } else if (normStroke === '#ffffff' || normStroke === '#fff') {
                  element.setAttribute('stroke', bgDarkColor)
                  changed = true
                }
              } else {
                if (normStroke === '#ffffff' || normStroke === '#fff') {
                  element.setAttribute('stroke', targetDarkColor)
                  changed = true
                } else if (normStroke === bgDarkColor) {
                  element.setAttribute('stroke', '#ffffff')
                  changed = true
                }
              }
            }
          }
        })
      }
    } else {
      if (shape.options) {
        if (fromColors.has(normalize(shape.options.stroke))) {
          shape.options.stroke = to
          changed = true
        }
        if (fromColors.has(normalize(shape.options.fill))) {
          shape.options.fill = to
          changed = true
        }
      }
      // Text shapes store color directly
      if (shape.color !== undefined && fromColors.has(normalize(shape.color))) {
        shape.color = to
        changed = true
      }
      if (shape.strokeColor !== undefined && fromColors.has(normalize(shape.strokeColor))) {
        shape.strokeColor = to
        changed = true
      }
      if (shape.labelColor !== undefined) {
        const labelColor = normalize(shape.labelColor)
        if (fromColors.has(labelColor) || ['#e0e0e0', '#e8e3f3'].includes(labelColor)) {
          shape.labelColor = to
          changed = true
        }
      }
      // Text shapes keep their color in the restored SVG rather than on the
      // shape object. Update only theme-default fills; explicit user colors
      // remain untouched.
      if (shape.group) {
        shape.group.querySelectorAll('[fill]').forEach((element) => {
          if (fromColors.has(normalize(element.getAttribute('fill')))) {
            element.setAttribute('fill', to)
            changed = true
          }
        })
      }
    }
    if (changed && typeof shape.draw === 'function') {
      shape.draw()
    }
  }
}

/**
 * Apply the CANVAS theme. The engine reads `body.theme-light|dark` for
 * theme-default stroke colours and `html[data-canvas-theme]` for the canvas
 * background; nothing else on the page depends on it.
 */
export function applyTheme(theme) {
  const body = typeof document !== 'undefined' ? document.body : null
  if (!body) return resolveTheme(theme)
  const resolved = resolveTheme(theme)
  body.classList.remove('theme-dark', 'theme-light')
  body.classList.add(`theme-${resolved}`)
  body.dataset.resolvedTheme = resolved
  document.documentElement.dataset.canvasTheme = resolved
  return resolved
}

/** Apply the workspace chrome (UI) theme. Independent from the canvas. */
export function applyUITheme(theme) {
  const body = typeof document !== 'undefined' ? document.body : null
  if (!body) return resolveTheme(theme)
  const resolved = resolveTheme(theme)
  body.classList.remove('ui-dark', 'ui-light')
  body.classList.add(`ui-${resolved}`)
  body.dataset.uiTheme = resolved
  document.documentElement.style.colorScheme = resolved
  return resolved
}

/**
 * Undo everything the workspace applied to <html>/<body> so site routes
 * reached by client navigation render with their own light defaults.
 */
export function clearWorkspaceTheme() {
  if (typeof document === 'undefined') return
  const body = document.body
  const root = document.documentElement
  body?.classList.remove('canvas-mode', 'theme-dark', 'theme-light', 'ui-dark', 'ui-light')
  if (body) {
    delete body.dataset.resolvedTheme
    delete body.dataset.uiTheme
  }
  delete root.dataset.canvasTheme
  root.style.removeProperty('color-scheme')
  root.style.removeProperty('--lixsketch-canvas-background')
}

function applyCanvasTheme(resolved) {
  useSketchStore.getState().restoreCanvasBackground(resolved)
}

const useUIStore = create((set, get) => ({
  // --- Modals ---
  saveModalOpen: false,
  aiModalOpen: false,
  commandPaletteOpen: false,
  exportImageModalOpen: false,
  findBarOpen: false,
  canvasPropertiesOpen: false,
  imageGenerateModalOpen: false,

  toggleSaveModal: () =>
    set((s) => ({ saveModalOpen: !s.saveModalOpen })),
  toggleAIModal: () =>
    set((s) => ({ aiModalOpen: !s.aiModalOpen })),
  toggleCommandPalette: () =>
    set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  toggleExportImageModal: () =>
    set((s) => ({ exportImageModalOpen: !s.exportImageModalOpen })),
  toggleFindBar: () =>
    set((s) => ({ findBarOpen: !s.findBarOpen })),
  closeFindBar: () =>
    set({ findBarOpen: false }),
  toggleCanvasProperties: () =>
    set((s) => ({ canvasPropertiesOpen: !s.canvasPropertiesOpen })),
  toggleImageGenerateModal: () =>
    set((s) => ({ imageGenerateModalOpen: !s.imageGenerateModalOpen })),
  closeImageGenerateModal: () =>
    set({ imageGenerateModalOpen: false }),
  closeAllModals: () =>
    set({ saveModalOpen: false, aiModalOpen: false, commandPaletteOpen: false, exportImageModalOpen: false, findBarOpen: false, canvasPropertiesOpen: false, imageGenerateModalOpen: false }),

  // --- Menu ---
  menuOpen: false,
  toggleMenu: () => set((s) => ({ menuOpen: !s.menuOpen })),
  closeMenu: () => set({ menuOpen: false }),

  // --- Workspace ---
  workspaceName: '',
  setWorkspaceName: (name) => {
    const workspaceName = limitWorkspaceName(name)
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('lixsketch-workspace-name', workspaceName) } catch {}
    }
    set({ workspaceName })
  },
  templateSlug: null,
  templateStatus: null,
  setTemplateInfo: (slug, status) => set({ templateSlug: slug, templateStatus: status }),

  // --- Save Status ---
  // 'idle' | 'local' | 'cloud' | 'failed'
  saveStatus: 'idle',
  setSaveStatus: (status) => set({ saveStatus: status }),

  // --- Session / Encryption ---
  // Key is persisted in localStorage keyed by session ID so it survives page refreshes.
  // This ensures re-saving a workspace uses the same key, keeping old share links valid.
  sessionEncryptionKey: null,
  setSessionEncryptionKey: (key, sessionId) => {
    if (typeof window !== 'undefined' && sessionId) {
      localStorage.setItem(`lixsketch-enc-key-${sessionId}`, key)
    }
    set({ sessionEncryptionKey: key })
  },
  loadEncryptionKeyForSession: (sessionId) => {
    if (typeof window !== 'undefined' && sessionId) {
      const stored = localStorage.getItem(`lixsketch-enc-key-${sessionId}`)
      if (stored) {
        set({ sessionEncryptionKey: stored })
        return stored
      }
    }
    return null
  },
  clearEncryptionKeyForSession: (sessionId) => {
    if (typeof window !== 'undefined' && sessionId) {
      localStorage.removeItem(`lixsketch-enc-key-${sessionId}`)
    }
    set({ sessionEncryptionKey: null })
  },

  // --- Canvas Loading ---
  canvasLoading: false,
  canvasLoadingMessage: 'Loading canvas...',
  setCanvasLoading: (loading, message) => set({ canvasLoading: loading, canvasLoadingMessage: message || 'Loading canvas...' }),

  // --- Theme ---
  // `theme` / `resolvedTheme` are the CANVAS theme (kept under these names
  // for existing consumers: sidebars, exports, docs, autosave).
  // `uiTheme` / `resolvedUITheme` are the workspace chrome theme.
  // Both default to light and are persisted separately.
  theme: 'light',
  resolvedTheme: 'light',
  uiTheme: 'light',
  resolvedUITheme: 'light',
  hydrateTheme: () => {
    const storage = browserStorage()
    const theme = readCanvasTheme(storage)
    const uiTheme = readUITheme(storage)
    const resolvedTheme = applyTheme(theme)
    const resolvedUITheme = applyUITheme(uiTheme)
    set({ theme, resolvedTheme, uiTheme, resolvedUITheme })
    applyCanvasTheme(resolvedTheme)
  },
  syncSystemTheme: () => {
    const { theme, uiTheme, resolvedTheme: previous } = get()
    if (uiTheme === 'system') set({ resolvedUITheme: applyUITheme('system') })
    if (theme !== 'system') return
    const resolvedTheme = applyTheme('system')
    invertShapeColors(previous, resolvedTheme)
    set({ resolvedTheme })
    applyCanvasTheme(resolvedTheme)
  },
  /** Change the canvas theme only. */
  setTheme: (newTheme) => {
    if (!isTheme(newTheme)) return
    const previous = get().resolvedTheme
    const resolvedTheme = applyTheme(newTheme)
    invertShapeColors(previous, resolvedTheme)
    set({ theme: newTheme, resolvedTheme })
    applyCanvasTheme(resolvedTheme)
    writeCanvasTheme(browserStorage(), newTheme)
  },
  setCanvasTheme: (newTheme) => get().setTheme(newTheme),
  /** Change the workspace chrome theme only; the canvas is untouched. */
  setUITheme: (newTheme) => {
    if (!isTheme(newTheme)) return
    const resolvedUITheme = applyUITheme(newTheme)
    set({ uiTheme: newTheme, resolvedUITheme })
    writeUITheme(browserStorage(), newTheme)
  },

  // --- Language / i18n ---
  language: 'en',
  setLanguage: (lang) => {
    set({ language: lang })
  },
  persistUIPrefs: (prefs) => {
    if (typeof window !== 'undefined') {
      const existing = localStorage.getItem('lix_ui_prefs')
      let parsed = {}
      try {
        if (existing) parsed = JSON.parse(existing)
      } catch (e) {}
      
      const updated = { ...parsed, ...prefs }
      localStorage.setItem('lix_ui_prefs', JSON.stringify(updated))
      
      if (prefs.language) {
        set({ language: prefs.language })
        window.dispatchEvent(new CustomEvent('lix-language-changed', { detail: { language: prefs.language } }))
      }
    }
  }
}))

export default useUIStore
