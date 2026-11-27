/**
 * Pure accessibility and structural scene model for LixSketch diagrams.
 *
 * Shared by canvas accessibility (#213 — shape-tree mirror, reading order,
 * names, relationships, live announcements) and headless MCP / agent tooling
 * (#235 — canonical shapeBounds, getSceneBounds, markup text extraction).
 *
 * Strictly pure and non-mutating on inputs: no DOM, window, or RoughJS runtime
 * dependencies. Accepts serialized v1 scenes, flat arrays of serialized or
 * runtime-shaped objects, and normalized SceneDoc OT documents.
 * `buildAccessibleSceneTree` returns a deeply frozen snapshot tree.
 */

import { readArrowheads, readLineArrowheads } from "./ArrowHeads.js";
import { docToScene } from "./collab/SceneDoc.js";
import { readContainerLabel } from "./ShapeLabelState.js";
import { unionBounds } from "./ViewportMath.js";

export const DEFAULT_ROW_TOLERANCE = 24;
const DEFAULT_MAX_LABEL_LENGTH = 80;

const XML_ENTITIES = {
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&amp;": "&",
};

const ROLE_DESCRIPTORS = Object.freeze({
    rectangle: { role: "graphics-symbol", roleLabel: "Rectangle" },
    circle: { role: "graphics-symbol", roleLabel: "Circle" },
    line: { role: "graphics-symbol", roleLabel: "Line" },
    arrow: { role: "graphics-symbol", roleLabel: "Arrow" },
    freehandStroke: { role: "graphics-symbol", roleLabel: "Freehand stroke" },
    // Frames are canvas containers, not page landmarks (`region` would bloat
    // screen-reader landmark lists; `group` preserves containment cleanly).
    frame: { role: "group", roleLabel: "Frame" },
    text: { role: "note", roleLabel: "Text" },
    // WAI-ARIA 1.2 `figure` explicitly covers code snippets while allowing
    // `aria-label` (unlike WAI-ARIA 1.3 `code`, which prohibits author naming,
    // and `region`, which pollutes landmark navigation).
    code: { role: "figure", roleLabel: "Code block" },
    image: { role: "img", roleLabel: "Image" },
    icon: { role: "img", roleLabel: "Icon" },
});

function finiteNumber(value, fallback = 0) {
    if (value === null || value === undefined || value === "") return fallback;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function positiveNumber(value, fallback = 1) {
    return Math.max(1, finiteNumber(value, fallback));
}

function hasPositiveFiniteSize(shape) {
    return (
        shape.width !== null &&
        shape.width !== undefined &&
        shape.height !== null &&
        shape.height !== undefined &&
        Number.isFinite(Number(shape.width)) &&
        Number(shape.width) > 0 &&
        Number.isFinite(Number(shape.height)) &&
        Number(shape.height) > 0
    );
}

function parseFontSize(value) {
    if (typeof value === "number")
        return Number.isFinite(value) && value > 0 ? value : null;
    if (typeof value !== "string") return null;
    const match = value.trim().match(/^(\d+(?:\.\d+)?|\.\d+)(?:px)?$/i);
    if (!match) return null;
    const numeric = Number(match[1]);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function unescapeXml(value) {
    return String(value).replace(
        /&(lt|gt|quot|#39|apos|amp);/g,
        (match) => XML_ENTITIES[match] || match,
    );
}

function extractXmlAttr(markup, name) {
    if (typeof markup !== "string" || !markup) return "";
    const match = markup.match(new RegExp(`\\s${name}=(["'])([\\s\\S]*?)\\1`));
    return match ? unescapeXml(match[2]).trim() : "";
}

function extractTitleElementText(markup) {
    if (typeof markup !== "string" || !markup) return "";
    const match = markup.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return match ? extractMarkupText(match[1]) : "";
}

function truncateLabel(value, maxLength = DEFAULT_MAX_LABEL_LENGTH) {
    const clean = String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();
    if (!clean || clean.length <= maxLength) return clean;
    return `${clean.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function extractHostSummary(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) return "";
    try {
        return new URL(rawUrl).hostname || "";
    } catch {
        return "";
    }
}

function extractTopLevelTspanLines(markup) {
    const lines = [];
    const tagPattern = /<(\/?)tspan\b[^>]*>/gi;
    let depth = 0;
    let lineStart = -1;
    for (const match of markup.matchAll(tagPattern)) {
        const isClosing = match[1] === "/";
        const tagStart = match.index;
        const tagEnd = tagStart + match[0].length;
        if (!isClosing) {
            if (depth === 0) lineStart = tagEnd;
            depth += 1;
        } else if (depth > 0) {
            depth -= 1;
            if (depth === 0 && lineStart >= 0) {
                lines.push(
                    unescapeXml(
                        markup
                            .slice(lineStart, tagStart)
                            .replace(/<[^>]+>/g, ""),
                    ),
                );
                lineStart = -1;
            }
        }
    }
    return lines;
}

function freezeDeep(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value))
        return value;
    Object.freeze(value);
    for (const entry of Array.isArray(value) ? value : Object.values(value)) {
        freezeDeep(entry);
    }
    return value;
}

/**
 * Resolve the canonical shape type from either serialized scenes (`type`)
 * or runtime engine instances (`shapeName`).
 */
export function getShapeType(shape) {
    if (!shape || typeof shape !== "object") return "unknown";
    return shape.type || shape.shapeName || "unknown";
}

function getShapeId(shape, index = 0) {
    if (typeof shape?.shapeID === "string" && shape.shapeID)
        return shape.shapeID;
    if (typeof shape?.id === "string" && shape.id) return shape.id;
    return `shape-${index}`;
}

/**
 * Extract normalized text from serialized SVG/HTML markup without touching DOM APIs.
 * When `preserveLines` is true, top-level `<tspan>` / block boundaries stay separated by `\n`.
 */
export function extractMarkupText(markup = "", { preserveLines = false } = {}) {
    if (typeof markup !== "string" || !markup) return "";
    if (!preserveLines) {
        return unescapeXml(markup.replace(/<[^>]+>/g, " "))
            .replace(/\s+/g, " ")
            .trim();
    }
    const tspanLines = extractTopLevelTspanLines(markup);
    if (tspanLines.length > 0) {
        return tspanLines.join("\n").trimEnd();
    }
    const lineBreaksNormalized = markup
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n");
    return unescapeXml(lineBreaksNormalized.replace(/<[^>]+>/g, ""))
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function extractTextContent(shape, type) {
    if (typeof shape.mcpText === "string") return shape.mcpText;
    if (typeof shape.text === "string") return shape.text;
    if (typeof shape.code === "string") return shape.code;
    if (typeof shape.groupHTML === "string")
        return extractMarkupText(shape.groupHTML, { preserveLines: true });
    if (type === "code" && typeof shape.label === "string") return shape.label;
    if (typeof shape.group?.textContent === "string")
        return shape.group.textContent;
    return "";
}

/**
 * Estimate canonical axis-aligned world bounds `{ x, y, width, height }` for
 * any serialized, MCP, OT-unflattened, or runtime-shaped object.
 * Pure and non-mutating.
 */
export function shapeBounds(shape) {
    if (!shape || typeof shape !== "object") return null;
    const type = getShapeType(shape);

    if (type === "circle") {
        const rx = Math.max(0, finiteNumber(shape.rx, 0));
        const ry = Math.max(0, finiteNumber(shape.ry, 0));
        return {
            x: finiteNumber(shape.x) - rx,
            y: finiteNumber(shape.y) - ry,
            width: rx * 2,
            height: ry * 2,
        };
    }

    if (shape.startPoint && shape.endPoint) {
        const sx = finiteNumber(shape.startPoint.x);
        const sy = finiteNumber(shape.startPoint.y);
        const ex = finiteNumber(shape.endPoint.x);
        const ey = finiteNumber(shape.endPoint.y);
        return {
            x: Math.min(sx, ex),
            y: Math.min(sy, ey),
            width: Math.abs(ex - sx),
            height: Math.abs(ey - sy),
        };
    }

    if (Array.isArray(shape.points) && shape.points.length) {
        const xs = shape.points.map((point) => finiteNumber(point?.[0]));
        const ys = shape.points.map((point) => finiteNumber(point?.[1]));
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        return {
            x: minX,
            y: minY,
            width: Math.max(...xs) - minX,
            height: Math.max(...ys) - minY,
        };
    }

    if (
        type === "freehandStroke" &&
        shape.boundingBox &&
        typeof shape.boundingBox === "object"
    ) {
        const { x, y, width, height } = shape.boundingBox;
        if ([x, y, width, height].every((v) => Number.isFinite(Number(v)))) {
            return {
                x: Number(x),
                y: Number(y),
                width: Math.max(0, Number(width)),
                height: Math.max(0, Number(height)),
            };
        }
    }

    if (type === "text" || (type === "code" && !hasPositiveFiniteSize(shape))) {
        if (
            type === "text" &&
            typeof shape.mcpText !== "string" &&
            hasPositiveFiniteSize(shape)
        ) {
            return {
                x: finiteNumber(shape.x),
                y: finiteNumber(shape.y),
                width: Number(shape.width),
                height: Number(shape.height),
            };
        }
        const defaultFontSize = type === "code" ? 14 : 20;
        const fontSize =
            parseFontSize(shape.mcpFontSize) ??
            parseFontSize(shape.fontSize) ??
            parseFontSize(extractXmlAttr(shape.groupHTML, "font-size")) ??
            defaultFontSize;
        const lines = extractTextContent(shape, type).split("\n");
        const maxLineLength = Math.max(1, ...lines.map((line) => line.length));
        return {
            x: finiteNumber(shape.x),
            y: finiteNumber(shape.y),
            width: Math.ceil(maxLineLength * fontSize * 0.6),
            height: Math.ceil(lines.length * fontSize * 1.2),
        };
    }

    return {
        x: finiteNumber(shape.x),
        y: finiteNumber(shape.y),
        width: positiveNumber(shape.width),
        height: positiveNumber(shape.height),
    };
}

function extractSceneShapes(sceneOrShapes) {
    if (Array.isArray(sceneOrShapes))
        return sceneOrShapes.filter((s) => s && typeof s === "object");
    if (Array.isArray(sceneOrShapes?.shapes))
        return sceneOrShapes.shapes.filter((s) => s && typeof s === "object");
    if (sceneOrShapes?.shapes && typeof sceneOrShapes.shapes === "object") {
        return docToScene(sceneOrShapes).shapes.filter(
            (s) => s && typeof s === "object",
        );
    }
    return [];
}

/**
 * Union bounding box of all shapes in a scene, OT document, or shape list.
 * Pure and non-mutating.
 */
export function getSceneBounds(sceneOrShapes) {
    return unionBounds(extractSceneShapes(sceneOrShapes).map(shapeBounds));
}

/**
 * Extract the primary human-readable text or label associated with a shape,
 * without leaking raw markup tags or base64 image data URIs.
 */
export function getShapeLabel(shape) {
    if (!shape || typeof shape !== "object") return "";
    const type = getShapeType(shape);

    if (type === "rectangle" || type === "circle") {
        return String(readContainerLabel(shape).label || "").trim();
    }
    if (type === "frame") {
        const explicit =
            typeof shape.frameName === "string" && shape.frameName.trim()
                ? shape.frameName.trim()
                : typeof shape.label === "string"
                  ? shape.label.trim()
                  : "";
        if (explicit) return explicit;
        const frameType = shape.frameType || shape._frameType || null;
        return frameType === "web-embed"
            ? extractHostSummary(shape.webEmbedURL || shape._webEmbedURL)
            : "";
    }
    if (type === "text" || type === "code") {
        return extractTextContent(shape, type).trim();
    }
    if (type === "arrow" || type === "line") {
        return String(shape.label ?? shape.options?.label ?? "").trim();
    }
    if (type === "image") {
        return String(
            shape.altText ||
                shape.alt ||
                shape.ariaLabel ||
                shape.label ||
                extractXmlAttr(shape.elementHTML, "aria-label") ||
                extractXmlAttr(shape.elementHTML, "alt") ||
                extractXmlAttr(shape.elementHTML, "title") ||
                "",
        ).trim();
    }
    if (type === "icon") {
        return String(
            shape.altText ||
                shape.ariaLabel ||
                shape.iconName ||
                shape.label ||
                extractXmlAttr(shape.elementHTML, "aria-label") ||
                extractXmlAttr(shape.elementHTML, "data-icon-name") ||
                extractTitleElementText(shape.elementHTML) ||
                "",
        ).trim();
    }
    return String(
        shape.altText ||
            shape.ariaLabel ||
            shape.label ||
            shape.options?.label ||
            "",
    ).trim();
}

function readParentFrameId(shape) {
    if (!shape?.parentFrame) return null;
    if (typeof shape.parentFrame === "string") return shape.parentFrame;
    if (
        typeof shape.parentFrame === "object" &&
        typeof shape.parentFrame.shapeID === "string"
    ) {
        return shape.parentFrame.shapeID;
    }
    return null;
}

function readContainedIds(frameShape) {
    const ids = [];
    if (Array.isArray(frameShape?.containedShapeIDs)) {
        for (const id of frameShape.containedShapeIDs) {
            if (typeof id === "string" && id) ids.push(id);
        }
    }
    const liveChildren = frameShape?.containedShapes;
    if (liveChildren && typeof liveChildren[Symbol.iterator] === "function") {
        for (const entry of liveChildren) {
            if (typeof entry === "string" && entry) ids.push(entry);
            else if (
                entry &&
                typeof entry === "object" &&
                typeof entry.shapeID === "string" &&
                entry.shapeID
            ) {
                ids.push(entry.shapeID);
            }
        }
    }
    return ids;
}

function resolveArrowEndpoint(shape, isStart) {
    const binding = isStart ? shape.startBinding : shape.endBinding;
    const attachmentId = isStart
        ? shape.startAttachmentID
        : shape.endAttachmentID;
    const liveAttachment = isStart
        ? shape.attachedToStart
        : shape.attachedToEnd;
    const legacyAttachment = isStart
        ? shape.startAttachment
        : shape.endAttachment;

    const rawId =
        binding?.shapeID ||
        attachmentId ||
        liveAttachment?.shape?.shapeID ||
        legacyAttachment?.shapeID ||
        null;
    const side = binding?.side ?? liveAttachment?.side ?? null;
    return {
        targetId: typeof rawId === "string" && rawId ? rawId : null,
        side,
    };
}

function readRoleMeta(shape, type) {
    const frameType = shape.frameType || shape._frameType || null;
    if (type === "frame") {
        if (frameType === "web-embed")
            return { role: "group", roleLabel: "Embedded web frame" };
        if (
            frameType === "diagram" ||
            shape.diagramType ||
            shape._diagramType
        ) {
            return { role: "group", roleLabel: "Diagram frame" };
        }
    }
    if (type === "image") {
        if (frameType === "graph") return { role: "img", roleLabel: "Graph" };
        if (shape.aiGenerated || shape.isAIGenerated)
            return { role: "img", roleLabel: "AI-generated image" };
    }
    return (
        ROLE_DESCRIPTORS[type] || {
            role: "graphics-symbol",
            roleLabel: type === "unknown" ? "Shape" : type,
        }
    );
}

function readDocBlockIds(shape) {
    const list = Array.isArray(shape?.docBlockIds)
        ? shape.docBlockIds
        : shape?.docBlockId
          ? [shape.docBlockId]
          : [];
    return [...new Set(list.filter((id) => typeof id === "string" && id))];
}

function isInFrameCycle(id, parentMap) {
    const visited = new Set();
    let cursor = parentMap.get(id) ?? null;
    while (cursor) {
        if (cursor === id) return true;
        if (visited.has(cursor)) return false;
        visited.add(cursor);
        cursor = parentMap.get(cursor) ?? null;
    }
    return false;
}

/**
 * Deterministic spatial comparator with z-order tie-breaking.
 * When two shapes overlap at identical `(x, y)` coordinates, `zIndex`
 * (the shape's source-array index) breaks ties in back-to-front paint/DOM
 * order, matching `LayerOrder.js`, `SceneSerializer.js`, and `SceneDoc.js`.
 * `id` serves as a final defensive tie-breaker.
 */
function compareReadingNodes(a, b, primaryAxis = "y") {
    const ax = a.bounds?.x ?? Infinity;
    const bx = b.bounds?.x ?? Infinity;
    const ay = a.bounds?.y ?? Infinity;
    const by = b.bounds?.y ?? Infinity;
    if (primaryAxis === "x") {
        if (ax !== bx) return ax - bx;
        if (ay !== by) return ay - by;
    } else {
        if (ay !== by) return ay - by;
        if (ax !== bx) return ax - bx;
    }
    if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Deterministic, transitive horizontal row-banded reading order:
 * top-to-bottom bands (anchored within `rowTolerance`), left-to-right per band.
 */
function sortSiblingsInReadingOrder(items, rowTolerance) {
    if (items.length <= 1) return [...items];
    const tol = Math.max(0, finiteNumber(rowTolerance, DEFAULT_ROW_TOLERANCE));
    const sortedTopDown = [...items].sort((a, b) =>
        compareReadingNodes(a, b, "y"),
    );
    const rows = [];
    let currentRow = [];
    let rowAnchorY = null;

    for (const item of sortedTopDown) {
        const y = item.bounds?.y ?? Infinity;
        if (
            !currentRow.length ||
            (Number.isFinite(y) &&
                Number.isFinite(rowAnchorY) &&
                y - rowAnchorY <= tol)
        ) {
            if (!currentRow.length) rowAnchorY = y;
            currentRow.push(item);
        } else {
            rows.push(currentRow);
            currentRow = [item];
            rowAnchorY = y;
        }
    }
    if (currentRow.length) rows.push(currentRow);

    const ordered = [];
    for (const row of rows) {
        row.sort((a, b) => compareReadingNodes(a, b, "x"));
        ordered.push(...row);
    }
    return ordered;
}

function roundCoord(value) {
    return Math.round(finiteNumber(value, 0));
}

function formatEndpointName(targetId, nodeById) {
    if (!targetId) return "";
    const target = nodeById.get(targetId);
    if (!target) return targetId;
    const short = truncateLabel(target.label, 40);
    return short ? `${target.roleLabel} ${short}` : target.roleLabel;
}

function buildAccessibleName(node, nodeById) {
    const summary = truncateLabel(node.label);
    if (node.type === "arrow") {
        const base = summary ? `${node.roleLabel}: ${summary}` : node.roleLabel;
        const startName = formatEndpointName(
            node.arrowEndpoints?.startTargetId,
            nodeById,
        );
        const endName = formatEndpointName(
            node.arrowEndpoints?.endTargetId,
            nodeById,
        );
        if (startName && endName)
            return `${base}, from ${startName} to ${endName}`;
        if (startName) return `${base}, from ${startName}`;
        if (endName) return `${base}, to ${endName}`;
        return base;
    }
    if (node.type === "code") {
        const prefix = node.language
            ? `${node.roleLabel} (${node.language})`
            : node.roleLabel;
        return summary ? `${prefix}: ${summary}` : prefix;
    }
    return summary ? `${node.roleLabel}: ${summary}` : node.roleLabel;
}

function buildAccessibleDescription(node, nodeById) {
    const parts = [];
    if (node.rawStartPoint && node.rawEndPoint) {
        parts.push(
            `from (${roundCoord(node.rawStartPoint.x)}, ${roundCoord(node.rawStartPoint.y)}) to (${roundCoord(node.rawEndPoint.x)}, ${roundCoord(node.rawEndPoint.y)})`,
        );
    } else if (node.bounds) {
        parts.push(
            `at (${roundCoord(node.bounds.x)}, ${roundCoord(node.bounds.y)}), ${roundCoord(node.bounds.width)} by ${roundCoord(node.bounds.height)}`,
        );
    }

    if (node.type === "frame") {
        const count = node.relationships.childIds.length;
        parts.push(
            count === 0
                ? "empty"
                : `contains ${count} ${count === 1 ? "item" : "items"}`,
        );
    }

    if (node.relationships.parentFrameId) {
        const parent = nodeById.get(node.relationships.parentFrameId);
        if (parent) {
            const parentName = parent.label
                ? `"${truncateLabel(parent.label, 40)}"`
                : parent.roleLabel;
            parts.push(`in frame ${parentName}`);
        }
    }

    if (node.relationships.groupMemberIds.length > 0) {
        parts.push(
            `in group of ${node.relationships.groupMemberIds.length + 1} shapes`,
        );
    }

    if (node.type !== "arrow") {
        const total =
            node.relationships.outgoingArrowIds.length +
            node.relationships.incomingArrowIds.length;
        if (total > 0)
            parts.push(
                `${total} ${total === 1 ? "connection" : "connections"}`,
            );
    }

    if (node.locked) parts.push("locked");
    if (node.relationships.link) parts.push("has link");
    if (node.relationships.docBlockIds.length > 0)
        parts.push("linked to document");
    return parts.join(", ");
}

function createBaseRecords(rawShapes) {
    const records = [];
    const byId = new Map();

    for (let index = 0; index < rawShapes.length; index += 1) {
        const raw = rawShapes[index];
        let id = getShapeId(raw, index);
        while (byId.has(id)) id = `${id}-${index}`;

        const type = getShapeType(raw);
        const roleMeta = readRoleMeta(raw, type);
        const link =
            typeof raw.link === "string" && raw.link.trim()
                ? raw.link.trim()
                : null;
        const arrowheads =
            type === "arrow"
                ? readArrowheads(raw)
                : type === "line"
                  ? readLineArrowheads(raw)
                  : null;
        const arrowEndpoints =
            type === "arrow"
                ? (() => {
                      const start = resolveArrowEndpoint(raw, true);
                      const end = resolveArrowEndpoint(raw, false);
                      return {
                          startTargetId: start.targetId,
                          startSide: start.side,
                          endTargetId: end.targetId,
                          endSide: end.side,
                      };
                  })()
                : null;

        const record = {
            id,
            shapeID: id,
            type,
            role: roleMeta.role,
            roleLabel: roleMeta.roleLabel,
            label: getShapeLabel(raw),
            language:
                type === "code"
                    ? String(
                          raw.language ||
                              extractXmlAttr(raw.groupHTML, "data-language") ||
                              "",
                      ).trim() || null
                    : null,
            bounds: shapeBounds(raw),
            zIndex: index,
            locked: Boolean(raw.locked),
            arrowheads,
            rawStartPoint: raw.startPoint
                ? {
                      x: finiteNumber(raw.startPoint.x),
                      y: finiteNumber(raw.startPoint.y),
                  }
                : null,
            rawEndPoint: raw.endPoint
                ? {
                      x: finiteNumber(raw.endPoint.x),
                      y: finiteNumber(raw.endPoint.y),
                  }
                : null,
            arrowEndpoints,
            relationships: {
                parentFrameId: readParentFrameId(raw),
                childIds: [],
                groupId:
                    typeof raw.groupId === "string" && raw.groupId
                        ? raw.groupId
                        : null,
                groupMemberIds: [],
                incomingArrowIds: [],
                outgoingArrowIds: [],
                connectedShapeIds: [],
                link,
                docBlockIds: readDocBlockIds(raw),
            },
        };
        records.push({ record, raw });
        byId.set(id, record);
    }

    return { records, byId };
}

function reconcileFrameContainment(records, byId) {
    for (const { record, raw } of records) {
        if (record.type !== "frame") continue;
        for (const childId of readContainedIds(raw)) {
            const child = byId.get(childId);
            if (
                child &&
                !child.relationships.parentFrameId &&
                childId !== record.id
            ) {
                child.relationships.parentFrameId = record.id;
            }
        }
    }

    const parentMap = new Map();
    for (const { record } of records) {
        const candidateParent = record.relationships.parentFrameId;
        const parentNode = candidateParent ? byId.get(candidateParent) : null;
        if (
            candidateParent &&
            candidateParent !== record.id &&
            parentNode?.type === "frame"
        ) {
            parentMap.set(record.id, candidateParent);
        } else {
            record.relationships.parentFrameId = null;
        }
    }

    for (const { record } of records) {
        if (
            record.relationships.parentFrameId &&
            isInFrameCycle(record.id, parentMap)
        ) {
            record.relationships.parentFrameId = null;
        }
    }
}

function indexGroupsAndArrows(records, byId) {
    const groups = new Map();
    for (const { record } of records) {
        const gid = record.relationships.groupId;
        if (!gid) continue;
        if (!groups.has(gid)) groups.set(gid, []);
        groups.get(gid).push(record.id);
    }
    for (const { record } of records) {
        const gid = record.relationships.groupId;
        if (gid)
            record.relationships.groupMemberIds = groups
                .get(gid)
                .filter((id) => id !== record.id);
    }

    const connections = [];
    for (const { record } of records) {
        if (record.type !== "arrow") continue;
        const startId =
            record.arrowEndpoints.startTargetId &&
            byId.has(record.arrowEndpoints.startTargetId)
                ? record.arrowEndpoints.startTargetId
                : null;
        const endId =
            record.arrowEndpoints.endTargetId &&
            byId.has(record.arrowEndpoints.endTargetId)
                ? record.arrowEndpoints.endTargetId
                : null;
        record.arrowEndpoints.startTargetId = startId;
        record.arrowEndpoints.endTargetId = endId;

        if (startId)
            byId.get(startId).relationships.outgoingArrowIds.push(record.id);
        if (endId)
            byId.get(endId).relationships.incomingArrowIds.push(record.id);
        if (startId && endId && startId !== endId) {
            const startNeighbors =
                byId.get(startId).relationships.connectedShapeIds;
            const endNeighbors =
                byId.get(endId).relationships.connectedShapeIds;
            if (!startNeighbors.includes(endId)) startNeighbors.push(endId);
            if (!endNeighbors.includes(startId)) endNeighbors.push(startId);
        }
        if (startId || endId) {
            connections.push({
                arrowId: record.id,
                startId,
                endId,
                startSide: record.arrowEndpoints.startSide,
                endSide: record.arrowEndpoints.endSide,
                label: record.label,
                startArrowhead: record.arrowheads?.startArrowhead || "none",
                endArrowhead: record.arrowheads?.endArrowhead || "arrow",
            });
        }
    }
    return connections;
}

function buildOrderedHierarchy(records, rowTolerance) {
    const childrenByParent = new Map();
    const topLevel = [];
    for (const { record } of records) {
        const pid = record.relationships.parentFrameId;
        if (!pid) {
            topLevel.push(record);
        } else {
            if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
            childrenByParent.get(pid).push(record);
        }
    }

    const orderedFlat = [];
    function populate(siblings, depth) {
        const treeNodes = [];
        for (const item of sortSiblingsInReadingOrder(siblings, rowTolerance)) {
            item.depth = depth;
            orderedFlat.push(item);
            const children = childrenByParent.has(item.id)
                ? populate(childrenByParent.get(item.id), depth + 1)
                : [];
            item.relationships.childIds = children.map((child) => child.id);
            treeNodes.push({ id: item.id, children });
        }
        return treeNodes;
    }

    return { rawRoots: populate(topLevel, 0), orderedFlat };
}

function toPublicNode(record, readingOrder, byId) {
    const node = {
        id: record.id,
        shapeID: record.shapeID,
        type: record.type,
        role: record.role,
        roleLabel: record.roleLabel,
        label: record.label,
        name: buildAccessibleName(record, byId),
        description: buildAccessibleDescription(record, byId),
        bounds: record.bounds,
        zIndex: record.zIndex,
        readingOrder,
        depth: record.depth,
        locked: record.locked,
        relationships: {
            ...record.relationships,
            ...(record.arrowEndpoints || {}),
        },
    };
    if (record.language) node.language = record.language;
    if (record.arrowheads) node.arrowheads = record.arrowheads;
    return node;
}

/**
 * Build a pure, non-mutating, deeply frozen accessible scene tree and
 * relationship index from a LixSketch scene (`{ shapes }`), OT doc (`SceneDoc`),
 * or shape array. Never mutates input shapes or scenes.
 */
export function buildAccessibleSceneTree(
    sceneOrShapes,
    { rowTolerance = DEFAULT_ROW_TOLERANCE } = {},
) {
    const rawShapes = extractSceneShapes(sceneOrShapes);
    const { records, byId } = createBaseRecords(rawShapes);
    reconcileFrameContainment(records, byId);
    const connections = indexGroupsAndArrows(records, byId);
    const { rawRoots, orderedFlat } = buildOrderedHierarchy(
        records,
        rowTolerance,
    );

    const nodes = orderedFlat.map((record, readingOrder) =>
        toPublicNode(record, readingOrder, byId),
    );
    const nodesById = Object.fromEntries(nodes.map((node) => [node.id, node]));

    function buildTreeObject(entry) {
        return {
            ...nodesById[entry.id],
            children: entry.children.map(buildTreeObject),
        };
    }

    return freezeDeep({
        bounds: unionBounds(nodes.map((node) => node.bounds)),
        nodes,
        roots: rawRoots.map(buildTreeObject),
        nodesById,
        readingOrderIds: nodes.map((node) => node.id),
        connections,
    });
}

function ensureModel(modelOrScene) {
    if (
        modelOrScene &&
        Array.isArray(modelOrScene.nodes) &&
        Array.isArray(modelOrScene.readingOrderIds) &&
        modelOrScene.nodesById
    ) {
        return modelOrScene;
    }
    return buildAccessibleSceneTree(modelOrScene);
}

/**
 * Pure reading-order navigation query returning the next or previous shape ID.
 * Useful both for UI focus movement (Phase B) and headless unit tests.
 */
export function getNextShapeId(
    modelOrScene,
    currentId = null,
    direction = 1,
    { wrap = true } = {},
) {
    const ids = ensureModel(modelOrScene).readingOrderIds;
    if (!ids.length) return null;

    const step = direction >= 0 ? 1 : -1;
    const currentIndex = currentId ? ids.indexOf(currentId) : -1;
    if (currentIndex < 0) {
        return step > 0 ? ids[0] : ids[ids.length - 1];
    }
    const nextIndex = currentIndex + step;
    if (nextIndex >= 0 && nextIndex < ids.length) return ids[nextIndex];
    if (!wrap) return null;
    return ids[(nextIndex + ids.length) % ids.length];
}

/**
 * Format a concise polite status announcement string for a single node
 * (WCAG 4.1.3), including ordinal position within the scene reading order.
 */
export function describeShapeForAnnouncement(
    modelOrScene,
    shapeId,
    { includePosition = true } = {},
) {
    const model = ensureModel(modelOrScene);
    const node = shapeId ? model.nodesById?.[shapeId] : null;
    if (!node) return "";

    const segments = [node.name];
    if (includePosition && model.nodes.length > 0) {
        segments.push(`${node.readingOrder + 1} of ${model.nodes.length}`);
    }
    if (node.description) segments.push(node.description);
    return segments.join(", ");
}
