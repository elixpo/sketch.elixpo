# Canvas Accessibility Baseline (Issue #213)

This document establishes the WCAG 2.2 accessibility baseline, current keyboard/screen-reader gap analysis, prior-art comparison, ARIA role mappings, reading-order/immutability contracts, and shared-architecture plan with Issue [#235](https://github.com/elixpo/sketch.elixpo/issues/235) for the LixSketch drawing canvas (Issue [#213](https://github.com/elixpo/sketch.elixpo/issues/213)).

> **Scope:** Canvas surface only (`#freehand-canvas` SVG, accessible shape-tree mirror, focus model, reading order, keyboard shape navigation/connection, and live status announcements). Toolbar, menu, modal, and sidebar chrome already received accessibility improvements under `#152`, `#166`–`#168`, `#220`, and `#232`.

---

## 1. Repository Interaction Reality

Although early notes referenced `src/core/interaction.js`, that file does not exist in this repository. Canvas interaction, shortcuts, and rendering are distributed across the core engine package (`packages/lixsketch`) and the Next.js host app (`src/`):

- **Canvas surface (dual React wrappers):**
  - `src/components/canvas/SVGCanvas.jsx` (`<svg id="freehand-canvas">`)
  - `packages/lixsketch/src/react/components/canvas/SVGCanvas.jsx` (`<svg id="freehand-canvas">`)
- **Imperative engine & pointer dispatch:**
  - `packages/lixsketch/src/SketchEngine.js`
  - `packages/lixsketch/src/core/EventDispatcher.js`
  - `packages/lixsketch/src/core/Selection.js` (`MultiSelection`, marquee selection, `deleteSelectedShapes`)
  - `packages/lixsketch/src/core/SceneSerializer.js` (serialization, `setArrowBinding`, `findTextOnCanvas`)
- **Keyboard shortcuts & post-selection commands:**
  - `packages/lixsketch/src/core/CanvasCommands.js` (`nudgeSelection`, `applyLayerAction`, `copyStyles`, `pasteStyles`, `editSelectedLabel`, `clearSelection`)
  - `packages/lixsketch/src/EngineShortcuts.js` (`installEngineShortcuts`, `SHORTCUT_MAP`)
  - `src/hooks/useKeyboardShortcuts.js` (app-level + canvas shortcuts)
  - Individual tool listeners (`packages/lixsketch/src/tools/arrowTool.js`, `UndoRedo.js`, etc.)
- **Pure scene data models:**
  - `packages/lixsketch/src/mcp/scene.js` (MCP headless scene schema, `validateScene`, `applyScenePatch`)
  - `packages/lixsketch/src/core/collab/SceneDoc.js` (OT flat records, `sceneRecords`, `docToScene`)
  - `packages/lixsketch/src/core/SceneAccessibilityModel.js` *(added in Phase A)*

---

## 2. WCAG Baseline Audit (2.1.1, 2.4.3, 2.4.7, 4.1.2, 4.1.3)

| Success Criterion | Level | Current Baseline State | Observed Evidence | Target Baseline Requirement |
| :--- | :--- | :--- | :--- | :--- |
| **2.1.1 Keyboard** | A | **Partial (post-selection only).** Once selected by pointer (or `Ctrl+A`), shapes can be nudged (`Arrow*` / `Shift+Arrow*`), reordered (`Ctrl+[/]`), labeled (`Enter`), duplicated (`Ctrl+D`), styled (`Ctrl+Alt+C/V`), grouped (`Ctrl+G`), and deleted (`Delete`/`Backspace`). **No keyboard path exists to reach, cycle, select, or connect individual shapes without a mouse.** | `CanvasCommands.js`, `EngineShortcuts.js`, `useKeyboardShortcuts.js`, `arrowTool.js` (`Ctrl+D` detach collides with Duplicate) | Non-trapping shortcuts to reach/select shapes in reading order, follow/initiate arrow connections (`source -> target`), edit/delete, and avoid existing shortcut collisions. |
| **2.4.3 Focus Order** | A | **Fails on canvas.** App chrome (`Toolbar.jsx`, `AppMenu.jsx`, `Header.jsx`) uses roving `tabindex` and arrow/Home/End navigation, but `#freehand-canvas` is absent from the tab order (`tabIndex` unset) and shapes expose no focus sequence. `Escape` drops `currentShape` without restoring focus cleanly. | `SVGCanvas.jsx` (both copies), `Toolbar.jsx`, `Header.jsx` | Canvas region participates as a single tab stop; an accessible shape-tree mirror exposes a deterministic hierarchical reading order (Frames before children; top-to-bottom row bands, left-to-right) with roving `tabindex` so `Tab` never traps focus (**2.1.2**). |
| **2.4.7 Focus Visible** | AA | **Fails on canvas.** Toolbar and header buttons style `:focus-visible` via `.lixsketch-tool-btn:focus-visible` (`styles.css`) and Tailwind `focus-visible:ring-2`. `<svg id="freehand-canvas">` has no `:focus-visible` styling, and off-screen keyboard-traversed shapes would not be brought into view. `biome.jsonc` sets `a11y` rules (`useButtonType`, `useAltText`, `useValidAriaValues`, `noSvgWithoutTitle`, `useSemanticElements`) to `"info"`. | `packages/lixsketch/src/react/styles.css`, `src/app/globals.css`, `SVGCanvas.jsx`, `biome.jsonc` | Visible high-contrast focus indicator on the canvas region and active focused shape, paired with viewport pan-into-view when focusing off-screen shapes. |
| **4.1.2 Name, Role, Value** | A | **Fails on canvas.** `<svg id="freehand-canvas">` has no `role`, `aria-label`, or `aria-roledescription`. Individual `<g>`/`<image>`/`<text>` shape elements expose no ARIA role, computed accessible name, selection state, containment hierarchy (`parentFrame`), or connection relationships. Only `ImageShape.showAIBadge()` sets `aria-label`/`<title>` on its synthetic-media badge. | `SVGCanvas.jsx` (both copies), `packages/lixsketch/src/shapes/*.js`, `ImageShape.js` | Semantic DOM shape-tree mirror backed by `SceneAccessibilityModel.js` providing consistent `role`, accessible `name`, `description` (geometry/bounds/tags), selection state (via `role="tree"` / `role="treeitem"` with `aria-selected`), Frame parent-child structure, and arrow bindings. |
| **4.1.3 Status Messages** | AA | **Fails on canvas.** Visual toasts exist for select actions (grouping, style copy, ruler toggle), but selection changes, shape focus traversal, nudging, layer changes, deletion, zoom changes, and connection prompts emit zero `aria-live` announcements. | `useKeyboardShortcuts.js`, `EngineShortcuts.js`, `CanvasCommands.js` | Dedicated polite `aria-live="polite"` / `role="status"` live region announcing focus/selection changes, connection workflow prompts, deletions, and structural updates without flooding rapid nudges. |

---

## 3. Current Keyboard Accessibility Gaps & Conflicts

1. **Unreachable shapes & disconnected workflow:**
   - Users must click to select a shape or drag-draw an arrow between endpoints (`arrowTool.js`). While `FindBar` (`Ctrl+F` -> `SceneSerializer.findTextOnCanvas`) can locate shapes that contain `<text>`/`<tspan>`/`foreignObject` or `frameName`, shapes without text (rectangles, circles, arrows, lines, icons, images, freehand strokes) cannot be reached by keyboard at all.
2. **Focus trap hazard if `Tab` is overloaded naively:**
   - Directly making every SVG `<g>` `tabindex="0"` would force users to tab through dozens or hundreds of diagram nodes to cross the canvas, and could interfere with drag handlers, `Frame` `clipGroup` clipping, and imperative SVG `viewBox` updates.
3. **Existing keyboard listener conflicts & unguarded listeners:**
   - `packages/lixsketch/src/tools/arrowTool.js` registers a global `keydown` handler for `Ctrl+D` (`detachSelectedArrow`), colliding with Duplicate (`Ctrl+D`) in `useKeyboardShortcuts.js` and `EngineShortcuts.js` (also documented as `Ctrl+D` in `src/components/modals/CommandPalette.jsx`).
   - `packages/lixsketch/src/core/UndoRedo.js` registers a global `keydown` handler for `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z` without checking `isTypingTarget` (`input`, `textarea`, `contentEditable`) or active UI controls.
   - Individual tool modules (`arrowTool.js`, `circleTool.js`, `frameTool.js`, `freehandTool.js`, `iconTool.js`, `imageTool.js`, `lineTool.js`) attach separate `Delete` listeners on `document` alongside centralized deletion in `Selection.js`, `EngineShortcuts.js`, and `useKeyboardShortcuts.js`.
   - `packages/lixsketch/src/EngineShortcuts.js` and `src/hooks/useKeyboardShortcuts.js` maintain parallel shortcut handlers, while `src/components/canvas/SVGCanvas.jsx` and `packages/lixsketch/src/react/components/canvas/SVGCanvas.jsx` mirror the canvas wrapper. Accessibility changes must keep both layers consistent.
4. **Already-claimed keys constraining navigation design:**
   - Unmodified single keys claimed in `SHORTCUT_MAP` / hooks: `a b d e f h i k l o p q r s t v w`, digits `0 1 2 4 5 6 7 8 9`, `?`, `Space`, `Enter`, `Delete`, `Backspace`, `Escape`, and `ArrowUp/Down/Left/Right` (plus `Shift+Arrow*` for nudging).
   - Plain `]` / `[` (without `Ctrl`) and plain `c` (without `Ctrl`/`Alt`) are currently free and align cleanly with `Ctrl+]`/`Ctrl+[` layer shortcuts.

---

## 4. Prior Art Comparison: Excalidraw vs tldraw

| Dimension | Excalidraw | tldraw | Recommended LixSketch Model |
| :--- | :--- | :--- | :--- |
| **Rendering Surface** | HTML5 `<canvas>` bitmap (no native DOM nodes per shape); accessible React chrome/dialogs; experimental DOM-in-canvas tracked in [`excalidraw#11378`](https://github.com/excalidraw/excalidraw/issues/11378) | DOM/HTML + CSS/SVG shape containers inside editor viewport ([tldraw accessibility docs](https://tldraw.dev/docs/accessibility)) | SVG canvas (`#freehand-canvas`) managed imperatively by `SketchEngine` |
| **Shape Accessibility Tree** | No per-shape ARIA DOM tree on the `<canvas>` surface; exported SVGs embedding scene JSON caused screen-reader friction ([`excalidraw#7338`](https://github.com/excalidraw/excalidraw/issues/7338)); open a11y gaps tracked under [`label:a11y`](https://github.com/excalidraw/excalidraw/issues?q=is%3Aissue+label%3Aa11y) | Shape descriptors via `ShapeUtil.getText()`, `ShapeUtil.getAriaDescriptor()` (including media `altText`), and `ShapeUtil.canTabTo()` ([`accessibility.mdx`](https://github.com/tldraw/tldraw/blob/main/apps/docs/content/sdk-features/accessibility.mdx)) | Visually hidden (`sr-only`) semantic **ARIA shape-tree mirror** synchronized from `SceneAccessibilityModel.js` so SVG rendering, `clipGroup`, and hit-testing remain untouched |
| **Reading Order** | N/A for per-shape canvas traversal; keyboard workflows center on shortcuts (`?`, `Ctrl+/`, `Alt+Arrow*`) documented in [Excalidraw Docs](https://docs.excalidraw.com/docs) | Row-banded top-to-bottom, left-to-right sequence exposed via `Editor.getCurrentPageShapesInReadingOrder()`, including locked shapes ([tldraw docs](https://tldraw.dev/docs/accessibility)) | Hierarchical reading order: top-level shapes ordered by transitive row bands (top-to-bottom, left-to-right), with `Frame` containers immediately preceding their ordered children |
| **Focus & Tab Model** | Chrome controls focusable; canvas relies on pointer selection and `Ctrl+A` / shortcut palette | `Tab` / `Shift+Tab` traversal across shapes in reading order plus directional/UI keyboard controls ([`accessibility.mdx`](https://github.com/tldraw/tldraw/blob/main/apps/docs/content/sdk-features/accessibility.mdx)) | **Roving `tabindex`** on the shape-tree mirror (`tabIndex={0}` on active item, `-1` on siblings) + non-trapping `]` / `[` traversal (keeps `Tab` exiting cleanly per WCAG 2.1.2 and leaves `Arrow*` free for nudge) |
| **Announcements** | Chrome action feedback; no live per-shape canvas selection narrator | Visually hidden live region via `DefaultA11yAnnouncer` (`"[description], [shape type]. [position] of [total]"`) + `useA11y()` + `prefers-reduced-motion` ([tldraw docs](https://tldraw.dev/docs/accessibility)) | Shared `SceneAccessibilityModel` name/description builder feeding a polite `aria-live="polite"` status announcer |

### Authoritative References

- **Excalidraw:**
  - Repository: https://github.com/excalidraw/excalidraw
  - Documentation hub: https://docs.excalidraw.com/docs
  - Accessibility issue tracker (`label:a11y`): https://github.com/excalidraw/excalidraw/issues?q=is%3Aissue+label%3Aa11y
  - Screen-reader issue with SVG embedded payloads: https://github.com/excalidraw/excalidraw/issues/7338
  - HTML-in-Canvas accessibility tree exploration: https://github.com/excalidraw/excalidraw/issues/11378
- **tldraw:**
  - Accessibility documentation: https://tldraw.dev/docs/accessibility
  - SDK accessibility documentation source (`accessibility.mdx`): https://github.com/tldraw/tldraw/blob/main/apps/docs/content/sdk-features/accessibility.mdx
  - Repository (`DefaultA11yAnnouncer`, `Editor.getCurrentPageShapesInReadingOrder`, `ShapeUtil`): https://github.com/tldraw/tldraw
- **W3C WAI-ARIA Specifications (for role & attribute validation):**
  - WAI-ARIA 1.2 (`tree`, `treeitem`, `figure`, `group`, `note`, `img`, `region`, `aria-selected`, `aria-current`, `aria-pressed`): https://www.w3.org/TR/wai-aria-1.2/
  - WAI-ARIA Graphics Module 1.0 (`graphics-document`, `graphics-object`, `graphics-symbol`): https://www.w3.org/TR/graphics-aria-1.0/
  - WAI-ARIA 1.3 (`code` role `Name From: prohibited` constraint): https://www.w3.org/TR/wai-aria-1.3/

---

## 5. ARIA Role Mapping, Reading-Order Tie-Breaking, and Immutability Contracts

### 5.1 Shape ARIA Role Mappings (`SceneAccessibilityModel.js`)

| Shape / Variant | `role` | `roleLabel` | Rationale (WAI-ARIA 1.2 / Graphics Module 1.0) |
| :--- | :--- | :--- | :--- |
| `rectangle`, `circle`, `line`, `arrow`, `freehandStroke` | `graphics-symbol` | `Rectangle`, `Circle`, `Line`, `Arrow`, `Freehand stroke` | Atomic vector symbols (`graphics-aria-1.0`); no required context role, supports `Name From: author`, and keeps internal RoughJS stroke/fill paths presentational. |
| `frame` (default, `_diagramType` / `diagram`, `web-embed`) | `group` | `Frame`, `Diagram frame`, `Embedded web frame` | Avoids `region` landmark bloat in screen-reader landmark rotors (many frames/subgraphs exist per diagram) while exposing containment hierarchy and supporting `aria-label`. |
| `code` | `figure` | `Code block` | Avoids `region` landmark bloat and avoids WAI-ARIA 1.3 `role="code"` (`Name From: prohibited`, which forbids `aria-label`). WAI-ARIA 1.2 `figure` explicitly covers code snippets and supports `Name From: author`. |
| `text` | `note` | `Text` | Non-landmark annotation role supporting `Name From: author` (`aria-label`) in WAI-ARIA 1.2/1.3. |
| `image` (default, `graph`, `aiGenerated`) | `img` | `Image`, `Graph`, `AI-generated image` | Standard graphic role with `Name From: author` (`altText` / `ariaLabel` / synthetic-media label). |
| `icon` | `img` | `Icon` | Atomic graphical icon with `Name From: author`. |

> **Phase B Mirror Selection Note:**
> - **Recommended selectable tree pattern:** Per WAI-ARIA 1.2 ([`aria-selected`](https://www.w3.org/TR/wai-aria-1.2/#aria-selected)), `aria-selected` is only valid on `gridcell`, `option`, `row`, `tab`, `columnheader`, `rowheader`, and `treeitem` (not on document/graphic roles such as `graphics-symbol`, `group`, `figure`, `note`, or `img`). When Phase B implements selectable items in the DOM shape-tree mirror, use a [`role="tree"`](https://www.w3.org/TR/wai-aria-1.2/#tree) container with [`role="treeitem"`](https://www.w3.org/TR/wai-aria-1.2/#treeitem) nodes carrying `aria-selected` (exposing `node.roleLabel` in the accessible name or `aria-roledescription`, and Frame containment via `aria-owns` / nested tree groups).
> - **Why `aria-current` and `aria-pressed` are not substitutes for selection:**
>   - Per WAI-ARIA 1.2 ([`aria-current`](https://www.w3.org/TR/wai-aria-1.2/#aria-current)), `aria-current` identifies the *current* item within a container or set of related elements (e.g., active navigation step or location) and is explicitly distinct from `aria-selected`; both can coexist on a `treeitem` with different meanings, so `aria-current` is not a generic replacement for selection state.
>   - Per WAI-ARIA 1.2 ([`aria-pressed`](https://www.w3.org/TR/wai-aria-1.2/#aria-pressed)), `aria-pressed` is only appropriate when an element is implemented as a toggle `button` (`role="button"` / `<button>`), not on tree items or graphic roles.
> - **Three distinct states to preserve in Phase B:** Keep (1) **keyboard focus** (roving `tabIndex={0}` / `document.activeElement` on the mirror `treeitem`), (2) **current navigation position** (active reading-order traversal cursor, optionally denoted via `aria-current="true"`), and (3) **actual canvas shape selection** (`aria-selected="true" | "false"` synchronized with `currentShape` / `MultiSelection`, where multiple shapes can be selected while focus rests on one item, or focus moves without altering selection) explicitly separated.

### 5.2 Reading-Order Tie-Breaking Contract

- Top-level siblings (and children within each `Frame`) are partitioned into transitive horizontal bands (`y - rowAnchorY <= rowTolerance`, default `24`) and sorted left-to-right (`x`), then top-to-bottom (`y`) on identical `x`.
- When two shapes overlap at **identical `(x, y)` coordinates**, `SceneAccessibilityModel` intentionally breaks ties by `zIndex` (ascending source-array index) with `id` as a final defensive tie-breaker. Across LixSketch (`LayerOrder.js`, `SceneSerializer.js`, and ascending `@z` in `SceneDoc.js`), source-array position is the canonical back-to-front stacking/paint order, so background layers precede foreground overlays deterministically.

### 5.3 Immutability Contract

- Every function in `SceneAccessibilityModel.js` is **pure and non-mutating** on inputs: input scenes, live `Frame`/`Arrow`/shape wrappers, and `SceneDoc` objects are never modified.
- `buildAccessibleSceneTree` returns a **deeply frozen snapshot tree** (`Object.freeze` recursively across the returned model, `bounds`, `nodes`, `roots`, `nodesById`, `readingOrderIds`, `connections`, and `relationships`), ensuring consumers cannot accidentally mutate shared descriptors.

---

## 6. Connection to Issue #235 (Agent Scene Model & Shared Code)

Issue [#235](https://github.com/elixpo/sketch.elixpo/issues/235) (*LixSketch collaborative agent editing: rebase, diffs and a diagram benchmark*) operates over the same `.lixsketch` v1 scene representation used by the MCP server (`packages/lixsketch/src/mcp/scene.js`) and collaboration OT layer (`packages/lixsketch/src/core/collab/SceneDoc.js`):

- **Shared data model:**
  - Shapes in both pipelines share `shapeID`, `type` (`shapeName` at runtime), `parentFrame`, `containedShapeIDs`, `groupId`, arrow bindings (`startAttachmentID`/`startBinding`, `endAttachmentID`/`endBinding`), labels/text (`label`, `frameName`, `mcpText`, `groupHTML`), and `docBlockIds` / `link`.
- **Code shared starting in Phase A (`SceneAccessibilityModel.js`):**
  1. **Single source of geometry (`shapeBounds`, `getSceneBounds`):** Previously private/duplicated inside `packages/lixsketch/src/mcp/scene.js`, bounding-box calculation now lives in pure `packages/lixsketch/src/core/SceneAccessibilityModel.js` (reusing `ViewportMath.unionBounds`) and is imported and re-exported by `mcp/scene.js`. Both MCP layout/preview/diffing (`#235`) and keyboard traversal / viewport pan-into-view (`#213`) compute identical bounds.
  2. **Single markup text extractor (`extractMarkupText`):** Shared between `mcp/scene.js` (for text updates and bounds estimation) and `SceneAccessibilityModel.js` (for accessible shape names and summaries), including nested `<tspan>` handling for syntax-highlighted code blocks.
  3. **Normalized relationship & reading-order model (`buildAccessibleSceneTree`):** Produces pure, deeply frozen nodes containing `parentFrameId`, ordered `childIds`, bidirectional arrow `incomingArrowIds`/`outgoingArrowIds`/`connectedShapeIds`, group siblings, and deterministic reading order. Future `#235` work (`canvas_diff`, structural diagram benchmarks checking edge connectivity and containment) can query this same pure model instead of re-deriving containment or graph edges.
- **Layering guarantee:** `SceneAccessibilityModel.js` sits in `packages/lixsketch/src/core/` with **zero DOM, `window`, or RoughJS globals**, below `packages/lixsketch/src/mcp/`, matching how `mcp/scene.js` already imports `core/ArrowHeads.js`.

---

## 7. Phased Rollout Plan (Beyond Phase A)

* **Phase A (this baseline):** Baseline documentation (`docs/accessibility-canvas-baseline.md`), pure shared `SceneAccessibilityModel.js` wired with `mcp/scene.js`, and unit tests (`scene-accessibility-model.test.js`).
* **Phase B (next PR step):** Canvas root ARIA semantics & focus ring (`SVGCanvas.jsx` in both `src/` and `packages/lixsketch/src/react/`), DOM shape-tree mirror, `]`/`[` & `Home`/`End` traversal, and off-screen pan-into-view.
* **Phase C:** Keyboard shape connection workflow (`c` -> target -> `Enter`) and cleanup of the `arrowTool.js` `Ctrl+D` conflict + `UndoRedo.js` typing guard.
* **Phase D:** Polite `aria-live` announcer (`CanvasCommands.js` / `EngineShortcuts.js` / `useKeyboardShortcuts.js`) and `CommandPalette.jsx` shortcut documentation.
