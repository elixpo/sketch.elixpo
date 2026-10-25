/* eslint-disable */
/**
 * Selection commands behind the Excalidraw-style keyboard shortcuts:
 * arrow-key nudge, layer order, copy/paste styles and label editing.
 *
 * Every function takes an optional `win` (defaults to the global window) so
 * the logic can be unit tested with plain objects instead of a live engine.
 */

const getWin = (win) => win || (typeof window !== 'undefined' ? window : {});

/** Shapes the next command acts on: the multi-selection, else the current shape. */
export function getSelectionTargets(win) {
    const w = getWin(win);
    const selected = w.multiSelection?.selectedShapes;
    if (selected && selected.size > 0) return Array.from(selected);
    const current = w.currentShape;
    return current && current.isSelected !== false ? [current] : [];
}

// ── Nudge ───────────────────────────────────────────────────────────

const NUDGE_KEYS = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
};

/** Arrow keys move 1px, Shift+arrow 10px (world units, like Excalidraw). */
export function nudgeDeltaForKey(key, shiftKey = false) {
    const dir = NUDGE_KEYS[key];
    if (!dir) return null;
    const step = shiftKey ? 10 : 1;
    return { dx: dir[0] * step, dy: dir[1] * step };
}

function captureState(w, shape) {
    const ms = w.multiSelection;
    if (ms && typeof ms._captureShapeState === 'function') return ms._captureShapeState(shape);
    return { x: shape.x, y: shape.y };
}

/**
 * Move the selection by (dx, dy) as one undoable step. Children of a
 * selected frame are skipped because the frame moves them.
 * Returns the number of shapes moved.
 */
export function nudgeSelection(dx, dy, win) {
    const w = getWin(win);
    const targets = getSelectionTargets(w).filter((shape) => typeof shape.move === 'function');
    if (!targets.length || (!dx && !dy)) return 0;
    const selectedSet = new Set(targets);
    const movable = targets.filter((shape) => !(shape.parentFrame && selectedSet.has(shape.parentFrame)));

    const before = new Map(movable.map((shape) => [shape, captureState(w, shape)]));
    const batch = typeof w.beginUndoBatch === 'function' ? w.beginUndoBatch() : null;
    for (const shape of movable) {
        shape.move(dx, dy);
        if (typeof shape.finalizeMove === 'function') shape.finalizeMove();
        if (typeof shape.updateAttachedArrows === 'function') shape.updateAttachedArrows();
        if (typeof w.pushTransformAction === 'function') {
            w.pushTransformAction(shape, before.get(shape), captureState(w, shape));
        }
    }
    if (batch !== null && typeof w.endUndoBatch === 'function') w.endUndoBatch(batch, 'nudge');

    const ms = w.multiSelection;
    if (ms?.selectedShapes?.size > 0 && typeof ms.updateControls === 'function') ms.updateControls();
    return movable.length;
}

// ── Layer order ─────────────────────────────────────────────────────

/**
 * Excalidraw layer shortcuts:
 *   Ctrl+]        bring forward      Ctrl+Shift+]  bring to front
 *   Ctrl+[        send backward      Ctrl+Shift+[  send to back
 * Shift turns `[`/`]` into `{`/`}` on most layouts, so match `code` too.
 */
export function layerActionForShortcut(e) {
    if (!e || !(e.ctrlKey || e.metaKey) || e.altKey) return null;
    const right = e.code === 'BracketRight' || e.key === ']' || e.key === '}';
    const left = e.code === 'BracketLeft' || e.key === '[' || e.key === '{';
    if (right) return e.shiftKey ? 'bringToFront' : 'bringForward';
    if (left) return e.shiftKey ? 'sendToBack' : 'sendBackward';
    return null;
}

/**
 * Apply a layer action to every selected shape, ordered so relative
 * stacking inside the selection is preserved.
 */
export function applyLayerAction(action, win) {
    const w = getWin(win);
    const layer = w.__layerOrder;
    if (!layer || typeof layer[action] !== 'function') return 0;
    const order = Array.isArray(w.shapes) ? w.shapes : [];
    const targets = getSelectionTargets(w).filter((shape) => order.includes(shape));
    targets.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    // Moving up: handle the top-most first so shapes don't leapfrog each other.
    if (action === 'bringForward' || action === 'sendToBack') targets.reverse();
    for (const shape of targets) layer[action](shape);
    return targets.length;
}

// ── Copy / paste styles ─────────────────────────────────────────────

export const STYLE_OPTION_KEYS = [
    'stroke', 'strokeWidth', 'fill', 'fillStyle', 'strokeDasharray', 'roughness', 'opacity',
];

let styleClipboard = null;

/** Visual style of a shape (options subset + label/text color). */
export function extractStyle(shape) {
    if (!shape) return null;
    const style = {};
    if (shape.options) {
        for (const key of STYLE_OPTION_KEYS) {
            if (shape.options[key] !== undefined) style[key] = shape.options[key];
        }
    }
    if (shape.labelColor !== undefined) style.labelColor = shape.labelColor;
    const textEl = shape.shapeName === 'text' ? shape.group?.querySelector?.('text') : null;
    const textColor = textEl?.getAttribute?.('fill');
    if (textColor) style.textColor = textColor;
    return Object.keys(style).length ? style : null;
}

/** Apply a style captured by `extractStyle`, as an undoable options change. */
export function applyStyleToShape(shape, style, win) {
    if (!shape || !style) return false;
    const w = getWin(win);
    let changed = false;

    if (shape.options) {
        const optionChanges = {};
        for (const key of STYLE_OPTION_KEYS) {
            if (style[key] !== undefined && shape.options[key] !== style[key]) optionChanges[key] = style[key];
        }
        if (Object.keys(optionChanges).length) {
            const oldOptions = { ...shape.options };
            shape.options = { ...shape.options, ...optionChanges };
            if (typeof w.pushOptionsChangeAction === 'function') {
                w.pushOptionsChangeAction(shape, oldOptions, { ...shape.options });
            }
            changed = true;
        }
    }
    if (style.labelColor !== undefined && shape.labelColor !== undefined && shape.labelColor !== style.labelColor) {
        shape.labelColor = style.labelColor;
        changed = true;
    }
    const color = style.textColor || style.stroke;
    if (shape.shapeName === 'text' && color) {
        const textEl = shape.group?.querySelector?.('text');
        if (textEl && textEl.getAttribute('fill') !== color) {
            textEl.setAttribute('fill', color);
            changed = true;
        }
    }
    if (changed && typeof shape.draw === 'function') shape.draw();
    return changed;
}

export function copyStyles(win) {
    const [first] = getSelectionTargets(win);
    const style = extractStyle(first);
    if (!style) return false;
    styleClipboard = style;
    return true;
}

export function pasteStyles(win) {
    if (!styleClipboard) return 0;
    const w = getWin(win);
    const targets = getSelectionTargets(w);
    const batch = typeof w.beginUndoBatch === 'function' ? w.beginUndoBatch() : null;
    let count = 0;
    for (const shape of targets) if (applyStyleToShape(shape, styleClipboard, w)) count++;
    if (batch !== null && typeof w.endUndoBatch === 'function') w.endUndoBatch(batch, 'paste-styles');
    return count;
}

export function hasCopiedStyles() {
    return styleClipboard !== null;
}

export function resetStyleClipboard() {
    styleClipboard = null;
}

// ── Labels ──────────────────────────────────────────────────────────

/**
 * Enter on a single selected shape edits it: shapes with an embedded
 * label open the label editor, text shapes enter text edit mode.
 */
export function editSelectedLabel(win) {
    const w = getWin(win);
    const targets = getSelectionTargets(w);
    if (targets.length !== 1) return false;
    const shape = targets[0];
    if (typeof shape.startLabelEdit === 'function') {
        shape.startLabelEdit();
        return true;
    }
    if (shape.shapeName === 'text' && shape.group && typeof w.__enterTextEditMode === 'function') {
        w.__enterTextEditMode(shape.group);
        return true;
    }
    return false;
}

export function initCanvasCommands() {
    if (typeof window === 'undefined') return;
    window.__canvasCommands = {
        getSelectionTargets: () => getSelectionTargets(window),
        nudgeSelection: (dx, dy) => nudgeSelection(dx, dy, window),
        applyLayerAction: (action) => applyLayerAction(action, window),
        copyStyles: () => copyStyles(window),
        pasteStyles: () => pasteStyles(window),
        hasCopiedStyles,
        editSelectedLabel: () => editSelectedLabel(window),
        duplicate: (options) => (typeof window.duplicateSelected === 'function' ? window.duplicateSelected(options) : []),
    };
}
