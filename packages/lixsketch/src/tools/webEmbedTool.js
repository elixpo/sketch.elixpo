/* eslint-disable */

import { Frame } from '../shapes/Frame.js';
import { pushCreateAction } from '../core/UndoRedo.js';
import { normalizeWebEmbedUrl } from '../core/WebEmbedPolicy.js';

let frame = null, start = null;
function coords(e) {
    const vb = svg.viewBox.baseVal, rect = svg.getBoundingClientRect();
    return { x: vb.x + ((e.clientX - rect.left) / rect.width) * vb.width, y: vb.y + ((e.clientY - rect.top) / rect.height) * vb.height };
}

export function handleWebEmbedDown(e) {
    const url = normalizeWebEmbedUrl(window.__pendingWebEmbedURL);
    if (!window.isWebEmbedToolActive || !url) { window.__showWebEmbedModal?.(); return; }
    start = coords(e);
    frame = new Frame(start.x, start.y, 0, 0, { frameName: 'Web embed', frameType: 'web-embed', webEmbedURL: url, stroke: '#8b76d6', strokeWidth: 2 });
    shapes.push(frame); currentShape = frame;
}

export function handleWebEmbedMove(e) {
    if (!frame || !start) return;
    const p = coords(e); frame.x = Math.min(start.x, p.x); frame.y = Math.min(start.y, p.y);
    frame.width = Math.abs(p.x - start.x); frame.height = Math.abs(p.y - start.y); frame.draw();
}

export function handleWebEmbedUp() {
    if (!frame) return;
    if (frame.width < 40 || frame.height < 30) { frame.width = 560; frame.height = 315; }
    frame.draw(); pushCreateAction(frame); frame.selectFrame(); currentShape = frame;
    window.__pendingWebEmbedURL = null; frame = null; start = null;
    window.__sketchStoreApi?.setActiveTool('select', { afterDraw: true });
}

