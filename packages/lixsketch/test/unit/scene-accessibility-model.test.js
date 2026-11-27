import { describe, expect, it } from "vitest";
import { docFromScene } from "../../src/core/collab/SceneDoc.js";
import {
    buildAccessibleSceneTree,
    describeShapeForAnnouncement,
    extractMarkupText,
    getNextShapeId,
    getSceneBounds,
    getShapeLabel,
    getShapeType,
    shapeBounds,
} from "../../src/core/SceneAccessibilityModel.js";
import {
    applyScenePatch,
    createEmptyScene,
    getSceneBounds as getMcpSceneBounds,
    shapeBounds as mcpShapeBounds,
} from "../../src/mcp/scene.js";

describe("SceneAccessibilityModel purity and MCP reuse", () => {
    it("runs without browser DOM or window globals", () => {
        expect(typeof globalThis.window).toBe("undefined");
        expect(typeof globalThis.document).toBe("undefined");
        const tree = buildAccessibleSceneTree({
            shapes: [
                {
                    shapeID: "r1",
                    type: "rectangle",
                    x: 10,
                    y: 20,
                    width: 100,
                    height: 50,
                    label: "Box",
                },
            ],
        });
        expect(tree.readingOrderIds).toEqual(["r1"]);
    });

    it("shares canonical shapeBounds and getSceneBounds implementations with MCP scene code", () => {
        expect(mcpShapeBounds).toBe(shapeBounds);
        expect(getMcpSceneBounds).toBe(getSceneBounds);

        const { scene } = applyScenePatch(createEmptyScene("Shared geometry"), [
            {
                op: "add",
                shape: {
                    type: "rectangle",
                    shapeID: "box",
                    x: 20,
                    y: 30,
                    width: 120,
                    height: 60,
                },
            },
            {
                op: "add",
                shape: {
                    type: "circle",
                    shapeID: "node",
                    x: 260,
                    y: 80,
                    rx: 40,
                    ry: 25,
                },
            },
            {
                op: "add",
                shape: {
                    type: "arrow",
                    shapeID: "link",
                    startPoint: { x: 140, y: 60 },
                    endPoint: { x: 220, y: 80 },
                },
            },
            {
                op: "add",
                shape: {
                    type: "text",
                    shapeID: "lbl",
                    x: 50,
                    y: 150,
                    text: "Hello\nWorld",
                    fontSize: 20,
                },
            },
        ]);

        const tree = buildAccessibleSceneTree(scene);
        for (const shape of scene.shapes) {
            expect(tree.nodesById[shape.shapeID].bounds).toEqual(
                mcpShapeBounds(shape),
            );
        }
        expect(tree.bounds).toEqual(getMcpSceneBounds(scene));
        expect(getSceneBounds({ shapes: [] })).toBeNull();
    });

    it("extracts XML-unescaped text from SVG markup including nested tspans and px font sizes", () => {
        const markup =
            '<g><text x="0" y="0"><tspan x="0" dy="0">Auth &amp; API</tspan><tspan x="0" dy="1.2em">&lt;v2&gt;</tspan></text></g>';
        expect(extractMarkupText(markup)).toBe("Auth & API <v2>");
        expect(extractMarkupText(markup, { preserveLines: true })).toBe(
            "Auth & API\n<v2>",
        );
        expect(extractMarkupText("")).toBe("");

        const highlightedCode =
            '<g><text data-language="javascript" font-size="25px"><tspan x="0" dy="0"><tspan fill="#ff7b72">const</tspan> ok = true;</tspan><tspan x="0" dy="1.2em"><tspan fill="#ff7b72">return</tspan> ok;</tspan></text></g>';
        expect(
            extractMarkupText(highlightedCode, { preserveLines: true }),
        ).toBe("const ok = true;\nreturn ok;");

        const codeBounds = shapeBounds({
            type: "code",
            x: 10,
            y: 20,
            groupHTML: highlightedCode,
        });
        expect(codeBounds).toEqual({
            x: 10,
            y: 20,
            width: Math.ceil(16 * 25 * 0.6),
            height: Math.ceil(2 * 25 * 1.2),
        });
    });
});

describe("accessible names, roles, labels, and descriptions across shape types", () => {
    it("computes WAI-ARIA roles, labels, bounds, and descriptions for serialized and runtime-style shapes", () => {
        const shapes = [
            {
                shapeID: "rect-1",
                type: "rectangle",
                x: 10,
                y: 10,
                width: 160,
                height: 80,
                options: { label: "Client App" },
            },
            {
                shapeID: "circ-1",
                shapeName: "circle",
                x: 300,
                y: 50,
                rx: 30,
                ry: 30,
                label: "Cache",
            },
            {
                shapeID: "arr-1",
                type: "arrow",
                startPoint: { x: 170, y: 50 },
                endPoint: { x: 270, y: 50 },
                startAttachmentID: "rect-1",
                endAttachmentID: "circ-1",
                label: "reads",
            },
            {
                shapeID: "line-1",
                shapeName: "line",
                startPoint: { x: 10, y: 200 },
                endPoint: { x: 90, y: 200 },
                endArrowhead: "bar",
            },
            {
                shapeID: "stroke-1",
                shapeName: "freehandStroke",
                boundingBox: { x: 120, y: 180, width: 45, height: 20 },
            },
            {
                shapeID: "txt-1",
                type: "text",
                x: 10,
                y: 250,
                groupHTML:
                    '<g><text font-size="16"><tspan>Notes &amp; next steps</tspan></text></g>',
            },
            {
                shapeID: "code-1",
                type: "code",
                x: 10,
                y: 310,
                groupHTML:
                    '<g><text data-language="javascript" font-size="14"><tspan>const ok = true;</tspan></text></g>',
            },
            {
                shapeID: "img-1",
                type: "image",
                x: 240,
                y: 250,
                width: 180,
                height: 120,
                href: "data:image/png;base64,AAAA",
                aiGenerated: true,
            },
            {
                shapeID: "ico-1",
                type: "icon",
                x: 450,
                y: 250,
                width: 48,
                height: 48,
                elementHTML: '<g aria-label="Database"></g>',
            },
            {
                shapeID: "emb-1",
                shapeName: "frame",
                x: 10,
                y: 460,
                width: 320,
                height: 180,
                _frameType: "web-embed",
                _webEmbedURL: "https://docs.example.com/guide",
                locked: true,
                link: "https://example.com",
                docBlockIds: ["blk-1"],
            },
            {
                shapeID: "diag-1",
                shapeName: "frame",
                x: 400,
                y: 460,
                width: 300,
                height: 200,
                frameName: "Auth Flow",
                _diagramType: "mermaid-flowchart",
            },
            {
                shapeID: "graph-1",
                type: "image",
                x: 750,
                y: 460,
                width: 240,
                height: 160,
                frameType: "graph",
                altText: "y = x^2",
            },
        ];

        const tree = buildAccessibleSceneTree(shapes);
        expect(getShapeType(shapes[1])).toBe("circle");
        expect(getShapeLabel(shapes[7])).toBe("");

        expect(tree.nodesById["rect-1"]).toMatchObject({
            role: "graphics-symbol",
            roleLabel: "Rectangle",
            label: "Client App",
            name: "Rectangle: Client App",
        });
        expect(tree.nodesById["circ-1"]).toMatchObject({
            role: "graphics-symbol",
            roleLabel: "Circle",
            label: "Cache",
            name: "Circle: Cache",
            bounds: { x: 270, y: 20, width: 60, height: 60 },
        });
        expect(tree.nodesById["arr-1"].name).toBe(
            "Arrow: reads, from Rectangle Client App to Circle Cache",
        );
        expect(tree.nodesById["arr-1"].description).toContain(
            "from (170, 50) to (270, 50)",
        );
        expect(tree.nodesById["stroke-1"].bounds).toEqual({
            x: 120,
            y: 180,
            width: 45,
            height: 20,
        });
        expect(tree.nodesById["txt-1"]).toMatchObject({
            role: "note",
            name: "Text: Notes & next steps",
        });
        expect(tree.nodesById["code-1"]).toMatchObject({
            role: "figure",
            roleLabel: "Code block",
            language: "javascript",
            name: "Code block (javascript): const ok = true;",
        });
        expect(tree.nodesById["img-1"]).toMatchObject({
            role: "img",
            roleLabel: "AI-generated image",
            name: "AI-generated image",
        });
        expect(tree.nodesById["img-1"].name).not.toContain("data:image");
        expect(tree.nodesById["ico-1"]).toMatchObject({
            role: "img",
            roleLabel: "Icon",
            name: "Icon: Database",
        });
        expect(tree.nodesById["emb-1"]).toMatchObject({
            role: "group",
            roleLabel: "Embedded web frame",
            name: "Embedded web frame: docs.example.com",
        });
        expect(tree.nodesById["emb-1"].description).toContain(
            "empty, locked, has link, linked to document",
        );
        expect(tree.nodesById["diag-1"]).toMatchObject({
            role: "group",
            roleLabel: "Diagram frame",
            name: "Diagram frame: Auth Flow",
        });
        expect(tree.nodesById["graph-1"]).toMatchObject({
            role: "img",
            roleLabel: "Graph",
            name: "Graph: y = x^2",
        });
    });

    it("builds readable polite status announcements with ordinal position", () => {
        const model = buildAccessibleSceneTree([
            {
                shapeID: "b",
                type: "rectangle",
                x: 220,
                y: 20,
                width: 80,
                height: 40,
                label: "Second",
            },
            {
                shapeID: "a",
                type: "rectangle",
                x: 20,
                y: 20,
                width: 80,
                height: 40,
                label: "First",
            },
        ]);

        expect(describeShapeForAnnouncement(model, "a")).toBe(
            "Rectangle: First, 1 of 2, at (20, 20), 80 by 40",
        );
        expect(
            describeShapeForAnnouncement(model, "b", {
                includePosition: false,
            }),
        ).toBe("Rectangle: Second, at (220, 20), 80 by 40");
        expect(describeShapeForAnnouncement(model, "missing")).toBe("");
    });
});

describe("relationships, immutability, containment, and SceneDoc interoperability", () => {
    it("resolves frame containment, group members, and live/serialized arrow attachments without mutating input", () => {
        const frameObj = {
            shapeID: "frame-api",
            shapeName: "frame",
            x: 0,
            y: 0,
            width: 500,
            height: 300,
            frameName: "API Layer",
            containedShapes: new Set(),
        };
        const boxA = {
            shapeID: "auth",
            shapeName: "rectangle",
            x: 40,
            y: 60,
            width: 120,
            height: 60,
            label: "Auth",
            parentFrame: frameObj,
            groupId: "grp-1",
        };
        const boxB = {
            shapeID: "gateway",
            shapeName: "rectangle",
            x: 240,
            y: 60,
            width: 120,
            height: 60,
            label: "Gateway",
            groupId: "grp-1",
        };
        frameObj.containedShapes.add(boxA);
        frameObj.containedShapes.add(boxB);

        const liveArrow = {
            shapeID: "edge-1",
            shapeName: "arrow",
            startPoint: { x: 160, y: 90 },
            endPoint: { x: 240, y: 90 },
            attachedToStart: { shape: boxA, side: "right" },
            attachedToEnd: { shape: boxB, side: "left" },
        };
        const danglingArrow = {
            shapeID: "edge-dangling",
            type: "arrow",
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 10, y: 10 },
            startAttachmentID: "auth",
            endAttachmentID: "deleted-node",
        };

        const originalParentOfB = boxB.parentFrame;
        const tree = buildAccessibleSceneTree([
            boxB,
            frameObj,
            liveArrow,
            boxA,
            danglingArrow,
        ]);
        expect(boxB.parentFrame).toBe(originalParentOfB);
        expect(Object.isFrozen(frameObj)).toBe(false);
        expect(Object.isFrozen(boxA)).toBe(false);

        expect(tree.nodesById["frame-api"]).toMatchObject({
            role: "group",
            roleLabel: "Frame",
        });
        expect(tree.nodesById["frame-api"].relationships.childIds).toEqual([
            "auth",
            "gateway",
        ]);
        expect(tree.nodesById["auth"].relationships).toMatchObject({
            parentFrameId: "frame-api",
            groupId: "grp-1",
            groupMemberIds: ["gateway"],
            outgoingArrowIds: ["edge-1", "edge-dangling"],
            incomingArrowIds: [],
            connectedShapeIds: ["gateway"],
        });
        expect(tree.nodesById["gateway"].relationships).toMatchObject({
            parentFrameId: "frame-api",
            groupMemberIds: ["auth"],
            outgoingArrowIds: [],
            incomingArrowIds: ["edge-1"],
            connectedShapeIds: ["auth"],
        });
        expect(tree.nodesById["edge-dangling"].relationships).toMatchObject({
            startTargetId: "auth",
            endTargetId: null,
        });
        expect(tree.connections).toHaveLength(2);
        expect(tree.nodesById["auth"].description).toContain(
            'in frame "API Layer", in group of 2 shapes, 2 connections',
        );
    });

    it("returns a deeply frozen snapshot tree whose fields cannot be mutated", () => {
        const tree = buildAccessibleSceneTree([
            {
                shapeID: "f1",
                type: "frame",
                x: 0,
                y: 0,
                width: 200,
                height: 200,
                frameName: "Box",
            },
            {
                shapeID: "r1",
                type: "rectangle",
                x: 20,
                y: 20,
                width: 60,
                height: 40,
                parentFrame: "f1",
            },
        ]);

        expect(Object.isFrozen(tree)).toBe(true);
        expect(Object.isFrozen(tree.bounds)).toBe(true);
        expect(Object.isFrozen(tree.nodes)).toBe(true);
        expect(Object.isFrozen(tree.roots)).toBe(true);
        expect(Object.isFrozen(tree.readingOrderIds)).toBe(true);
        expect(Object.isFrozen(tree.nodesById["f1"])).toBe(true);
        expect(Object.isFrozen(tree.nodesById["f1"].relationships)).toBe(true);
        expect(
            Object.isFrozen(tree.nodesById["f1"].relationships.childIds),
        ).toBe(true);
        expect(() => {
            tree.readingOrderIds.push("x");
        }).toThrow(TypeError);
        expect(() => {
            tree.nodesById["r1"].name = "mutated";
        }).toThrow(TypeError);
    });

    it("guards against self-parenting, non-frame parents, and frame cycles", () => {
        const shapes = [
            {
                shapeID: "self-f",
                type: "frame",
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                parentFrame: "self-f",
            },
            {
                shapeID: "bad-parent",
                type: "rectangle",
                x: 20,
                y: 20,
                width: 50,
                height: 50,
                parentFrame: "missing",
            },
            {
                shapeID: "rect-parent",
                type: "rectangle",
                x: 10,
                y: 100,
                width: 50,
                height: 50,
            },
            {
                shapeID: "non-frame-child",
                type: "rectangle",
                x: 20,
                y: 110,
                width: 30,
                height: 30,
                parentFrame: "rect-parent",
            },
            {
                shapeID: "f1",
                type: "frame",
                x: 200,
                y: 0,
                width: 100,
                height: 100,
                parentFrame: "f2",
            },
            {
                shapeID: "f2",
                type: "frame",
                x: 400,
                y: 0,
                width: 100,
                height: 100,
                parentFrame: "f1",
            },
            {
                shapeID: "ok-child",
                type: "rectangle",
                x: 210,
                y: 10,
                width: 30,
                height: 30,
                parentFrame: "f1",
            },
        ];
        const tree = buildAccessibleSceneTree(shapes);
        expect(tree.nodes).toHaveLength(7);
        for (const node of tree.nodes) {
            if (node.id === "ok-child")
                expect(node.relationships.parentFrameId).toBe("f1");
            else expect(node.relationships.parentFrameId).toBeNull();
        }
    });

    it("builds equivalent accessibility metadata from SceneDoc OT documents", () => {
        const scene = {
            format: "lixsketch",
            version: 1,
            shapes: [
                {
                    shapeID: "frame-1",
                    type: "frame",
                    x: 20,
                    y: 20,
                    width: 300,
                    height: 200,
                    frameName: "Backend",
                    containedShapeIDs: ["db"],
                },
                {
                    shapeID: "db",
                    type: "circle",
                    x: 160,
                    y: 120,
                    rx: 40,
                    ry: 30,
                    label: "Postgres",
                    parentFrame: "frame-1",
                    groupId: null,
                    docBlockIds: [],
                },
            ],
        };
        const otDoc = docFromScene(scene);
        const fromScene = buildAccessibleSceneTree(scene);
        const fromDoc = buildAccessibleSceneTree(otDoc);

        expect(fromDoc.readingOrderIds).toEqual(fromScene.readingOrderIds);
        expect(fromDoc.nodesById["db"].name).toBe("Circle: Postgres");
        expect(fromDoc.nodesById["db"].relationships.parentFrameId).toBe(
            "frame-1",
        );
    });
});

describe("deterministic reading order and navigation helpers", () => {
    it("orders rows top-to-bottom, left-to-right within rowTolerance, and visits frame children immediately after their frame", () => {
        const shapes = [
            {
                shapeID: "row2-right",
                type: "rectangle",
                x: 300,
                y: 140,
                width: 80,
                height: 40,
            },
            {
                shapeID: "row1-right",
                type: "rectangle",
                x: 250,
                y: 28,
                width: 80,
                height: 40,
            },
            {
                shapeID: "row1-left",
                type: "rectangle",
                x: 30,
                y: 12,
                width: 80,
                height: 40,
            },
            {
                shapeID: "frame-main",
                type: "frame",
                x: 20,
                y: 130,
                width: 220,
                height: 160,
                frameName: "Group",
            },
            {
                shapeID: "child-2",
                type: "rectangle",
                x: 130,
                y: 150,
                width: 60,
                height: 40,
                parentFrame: "frame-main",
            },
            {
                shapeID: "child-1",
                type: "rectangle",
                x: 40,
                y: 162,
                width: 60,
                height: 40,
                parentFrame: "frame-main",
            },
        ];

        const forward = buildAccessibleSceneTree(shapes, { rowTolerance: 24 });
        const reversed = buildAccessibleSceneTree([...shapes].reverse(), {
            rowTolerance: 24,
        });

        const expectedOrder = [
            "row1-left",
            "row1-right",
            "frame-main",
            "child-1",
            "child-2",
            "row2-right",
        ];
        expect(forward.readingOrderIds).toEqual(expectedOrder);
        expect(reversed.readingOrderIds).toEqual(expectedOrder);
        expect(forward.nodesById["frame-main"].depth).toBe(0);
        expect(forward.nodesById["child-1"].depth).toBe(1);
        expect(forward.roots.map((r) => r.id)).toEqual([
            "row1-left",
            "row1-right",
            "frame-main",
            "row2-right",
        ]);
        expect(forward.roots[2].children.map((c) => c.id)).toEqual([
            "child-1",
            "child-2",
        ]);
    });

    it("remains transitive and permutation-invariant even across borderline row-tolerance offsets", () => {
        const borderline = [
            {
                shapeID: "s1",
                type: "rectangle",
                x: 300,
                y: 0,
                width: 50,
                height: 30,
            },
            {
                shapeID: "s2",
                type: "rectangle",
                x: 100,
                y: 18,
                width: 50,
                height: 30,
            },
            {
                shapeID: "s3",
                type: "rectangle",
                x: 200,
                y: 35,
                width: 50,
                height: 30,
            },
        ];
        const expected = buildAccessibleSceneTree(borderline, {
            rowTolerance: 24,
        }).readingOrderIds;
        const permutations = [
            [borderline[2], borderline[0], borderline[1]],
            [borderline[1], borderline[2], borderline[0]],
            [borderline[0], borderline[2], borderline[1]],
        ];
        for (const candidate of permutations) {
            expect(
                buildAccessibleSceneTree(candidate, { rowTolerance: 24 })
                    .readingOrderIds,
            ).toEqual(expected);
        }
    });

    it("uses source-array z-order as back-to-front tie-breaker for identical (x, y) shapes and preserves OT z-order", () => {
        const back = {
            shapeID: "b",
            type: "rectangle",
            x: 50,
            y: 50,
            width: 200,
            height: 120,
        };
        const front = {
            shapeID: "a",
            type: "rectangle",
            x: 50,
            y: 50,
            width: 40,
            height: 40,
        };
        const third = {
            shapeID: "c",
            type: "rectangle",
            x: 50,
            y: 50,
            width: 40,
            height: 40,
        };

        // Array order is canonical z-order (index 0 = back, higher index = front).
        const sceneBackFirst = {
            format: "lixsketch",
            version: 1,
            shapes: [back, front, third],
        };
        const treeBackFirst = buildAccessibleSceneTree(sceneBackFirst);
        expect(treeBackFirst.readingOrderIds).toEqual(["b", "a", "c"]);
        expect(treeBackFirst.nodesById["b"].zIndex).toBe(0);
        expect(treeBackFirst.nodesById["a"].zIndex).toBe(1);
        expect(treeBackFirst.nodesById["c"].zIndex).toBe(2);

        // Equivalent OT document preserves the same z-order tie-breaking.
        expect(
            buildAccessibleSceneTree(docFromScene(sceneBackFirst))
                .readingOrderIds,
        ).toEqual(["b", "a", "c"]);

        // Moving `b` to the front of the z-order array deterministically updates reading order.
        const broughtForward = buildAccessibleSceneTree([front, third, back]);
        expect(broughtForward.readingOrderIds).toEqual(["a", "c", "b"]);

        // Same x with distinct y inside rowTolerance sorts by y regardless of array order.
        const sameXTop = {
            shapeID: "top",
            type: "rectangle",
            x: 50,
            y: 50,
            width: 40,
            height: 20,
        };
        const sameXBottom = {
            shapeID: "bottom",
            type: "rectangle",
            x: 50,
            y: 60,
            width: 40,
            height: 20,
        };
        expect(
            buildAccessibleSceneTree([sameXBottom, sameXTop]).readingOrderIds,
        ).toEqual(["top", "bottom"]);
        expect(
            buildAccessibleSceneTree([sameXTop, sameXBottom]).readingOrderIds,
        ).toEqual(["top", "bottom"]);
    });

    it("queries next and previous shape IDs with optional wrap-around", () => {
        const scene = [
            {
                shapeID: "a",
                type: "rectangle",
                x: 10,
                y: 10,
                width: 40,
                height: 40,
            },
            {
                shapeID: "b",
                type: "rectangle",
                x: 100,
                y: 10,
                width: 40,
                height: 40,
            },
            {
                shapeID: "c",
                type: "rectangle",
                x: 200,
                y: 10,
                width: 40,
                height: 40,
            },
        ];
        expect(getNextShapeId(scene, null, 1)).toBe("a");
        expect(getNextShapeId(scene, null, -1)).toBe("c");
        expect(getNextShapeId(scene, "a", 1)).toBe("b");
        expect(getNextShapeId(scene, "c", 1, { wrap: true })).toBe("a");
        expect(getNextShapeId(scene, "a", -1, { wrap: true })).toBe("c");
        expect(getNextShapeId(scene, "c", 1, { wrap: false })).toBeNull();
        expect(getNextShapeId(scene, "a", -1, { wrap: false })).toBeNull();
        expect(getNextShapeId([], null, 1)).toBeNull();
    });
});
