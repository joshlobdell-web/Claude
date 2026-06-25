# Artifact Syncs — Technical Specification

Full reference for the Artifact Map feature: data pipeline, rendering engine, integration points, confirmed API facts, and known bugs/status.

Source: `features/ArtifactMap/` | bc destination: `packages/bc-app/src/utils/ArtifactMap/`

---

## Project Overview

**Goal:** Native Onebrief feature — fullscreen "Artifact Syncs" overlay launched from the plan dropdown menu, showing every artifact relationship for a plan rendered on an interactive Canvas.

**Files in `joshlobdell-web/Claude` repo (cloud):**
- `/home/user/Claude/ArtifactMap/getArtifactMapData.ts` — 7-phase in-memory data pipeline
- `/home/user/Claude/ArtifactMap/ArtifactMapEngine.ts` — Canvas rendering engine (~1920 lines)
- `/home/user/Claude/ArtifactMap/ArtifactMapOverlay.tsx` — React fullscreen overlay wrapper
- `/home/user/Claude/ArtifactMap/ArtifactSyncsButton.tsx` — Toolbar button (not currently used; overlay is opened from PlanDropdownMenu)
- `/home/user/Claude/ArtifactMap/index.ts` — Barrel exports
- `/home/user/Claude/exportArtifactMap.ts` — Original standalone export (kept for reference; no longer the primary path)
- `/home/user/Claude/ONEBRIEF_DATA_MODEL.md` — this file

**bc destination (user's machine at `/root/repos/bc`):**
- `packages/bc-app/src/utils/ArtifactMap/` — all 5 files above (cp'd from cloud clone)

**Integration points in bc:**

**1. PlanDropdownMenu (existing)**
- `packages/bc-app/src/components/Brief/SideNav/PlanDropdownMenu.tsx`
  - Import: `import { ArtifactMapOverlay } from 'utils/ArtifactMap';`
  - State: `const [artifactMapOpen, setArtifactMapOpen] = useState(false);`
  - Menu item: "View Artifact Syncs" → `setArtifactMapOpen(true)`
  - Overlay: `<ArtifactMapOverlay isOpen={artifactMapOpen} onClose={() => setArtifactMapOpen(false)} briefId={briefId} briefTitle={brief.title ?? \`Plan ${briefId}\`} />`

**2. SyncSummaryDropdown — Focus-mode entry (new)**
- `packages/bc-app/src/components/Brief/Sync/SyncSummary/SyncSummaryDropdown.tsx`
- Uses `useCurrentScreenArtifact()` → `{ type: string; id: number }` for the currently-viewed artifact
- Artifact ID mapping: the engine uses `type + 's_' + id` for most types
  - board → `boards_${id}`, list → `lists_${id}`, card/node → `nodes_${id}`, section → `sections_${id}`
- Add this state and handler near the other state at the top of the component:
  ```tsx
  const [artifactMapOpen, setArtifactMapOpen] = useState(false);
  const screen = useCurrentScreenArtifact(); // already exists in this file
  ```
- Add a footer button inside the `<Menu name="root">` JSX, after the `<ODSDropdownScroll>`:
  ```tsx
  <ODSDropdownItem
    label="View in Artifact Map →"
    onClick={() => setArtifactMapOpen(true)}
  />
  ```
- Add the overlay before the closing `</>` of the return:
  ```tsx
  <ArtifactMapOverlay
    isOpen={artifactMapOpen}
    onClose={() => setArtifactMapOpen(false)}
    briefId={briefId}
    briefTitle={briefTitle}
    initialArtifactId={screen ? screen.type + 's_' + screen.id : undefined}
    openFocusOnLoad={true}
  />
  ```
  Note: `screen.type` from `useCurrentScreenArtifact()` returns the singular form (`'board'`, `'list'`, `'node'`). The engine uses plural + underscore (`boards_123`). Add an `'s'` suffix. Exception: if `screen.type === 'plan'`, use `'plan_' + screen.id` (plan IDs are not pluralized in the engine).
- Import at top: `import { ArtifactMapOverlay } from 'utils/ArtifactMap';`

**Deploy workflow (run on host machine):**
```bash
cp /tmp/claude-0/Claude/features/ArtifactMap/getArtifactMapData.ts /root/repos/bc/packages/bc-app/src/utils/ArtifactMap/
cp /tmp/claude-0/Claude/features/ArtifactMap/ArtifactMapEngine.ts /root/repos/bc/packages/bc-app/src/utils/ArtifactMap/
cp /tmp/claude-0/Claude/features/ArtifactMap/ArtifactMapOverlay.tsx /root/repos/bc/packages/bc-app/src/utils/ArtifactMap/
```

---

## Native Integration Architecture

### ArtifactMapEngine

Container-scoped Canvas 2D rendering engine. All DOM injected into the passed `container` element via `insertAdjacentHTML`. Uses `.am-` prefixed IDs throughout (no globals).

**Public API:**
```typescript
new ArtifactMapEngine(container: HTMLElement, options: { onClose: () => void; onAddPlan?: () => void })
engine.loadData(data: ArtifactMapData | ArtifactMapData[])       // one or multiple plans; merges on each call
engine.selectArtifact(id: string, openFocusView?: boolean): void // select by canonical ID; optionally open focus
engine.destroy()    // removes event listeners, clears container.innerHTML
```

**Key internals:**
- `buildDOM()` — injects `<style>` + full HTML structure (toolbar, tier labels, canvas, sidebar, focus overlay)
- `mergeAndRender()` — merges plan data, runs ghost detection, Phase 2 ghost expansion, calls `computeLayout()`
- `computeLayout()` — tiered layout: plan(5) → output products(4) → visual tools(3) → list boards(2) → lists(1) → cards(0) → references(-1)
- `drawDotGrid()` — 1px dots at 30px world-space intervals for whiteboard aesthetic
- `drawNode()` — renders artifact card; `↗S` teal badge when `art.syncedToOtherPlans === true`
- ESC key closes focus overlay first, then calls `onClose()`

**Toolbar structure:** `"Artifact Syncs"` title | sep | Reset View | [Impact + Focus group] | sep | Layers ▾ | sep | ＋ Plan | sep | [plan pills] | spacer | Close
- Impact and Focus share one button group; no "Deep Dive" button
- Focus button is disabled until a node is selected
- Layers ▾ opens a dropdown with per-tier show/hide checkboxes; hides nodes AND edges for hidden tiers
- ＋ Plan fires `options.onAddPlan()` callback; overlay handles the plan picker modal
- ESC closes layers panel first, then focus overlay, then the whole overlay

### ArtifactMapOverlay

React wrapper component. Mounts engine on open, fetches data, shows spinner, handles cleanup.

```tsx
<ArtifactMapOverlay
  isOpen={boolean}
  onClose={() => void}
  briefId={number}
  briefTitle={string}
  initialArtifactId?: string    // e.g. "boards_123" — auto-selects after data loads
  openFocusOnLoad?: boolean      // if true, opens focus view on the initialArtifactId
/>
```

- `position: fixed; inset: 0; z-index: 9999; background: #f8f9fa`
- `useEffect` on `[isOpen, briefId, briefTitle, onClose]` — creates engine with `onAddPlan` callback
- After `engine.loadData(data)`: if `initialArtifactId` provided, calls `requestAnimationFrame(() => engine.selectArtifact(id, openFocus))`
- Plan picker: `onAddPlan` → `setPickerOpen(true)` → `retrieveBriefs()` from `api-client/briefs` → modal list
- `addPlan(brief)` calls `getArtifactMapData(brief.id, brief.title)` → `engine.loadData(data)` (engine merges it in)
- Shows toast (`Adding plan…`) while an additional plan is loading
- Shows spinner (`Building artifact map…`) while first plan loads
- Shows error state with Close button on failure
- `engine.destroy()` called in cleanup
- Import: `import { retrieveBriefs } from 'api-client/briefs'` (bc-app path alias)

### ArtifactSyncsButton

Small inline button for use in toolbars (not the current wiring point — see PlanDropdownMenu above).

```tsx
<ArtifactSyncsButton briefId={number} briefTitle={string} />
```

Ghost-border button with network graph SVG icon and "Artifact Syncs" label. Manages overlay open state via `useState`.

---

## Onebrief UI Color Palette

Colors used in `ArtifactMapEngine` — light theme matching Onebrief's standard UI:

| Role | Value |
|---|---|
| Main background | `#f8f9fa` |
| Toolbar background | `#ffffff` (white — matches bc MenuBar) |
| Toolbar border | `#dde2e9` |
| Canvas background | `#f8f9fa` |
| Sidebar background | `#ffffff` |
| Sidebar border / dividers | `#dde2e9` |
| Primary text | `#212529` |
| Muted text | `#5b687b` |
| Button hover bg | `#f8f9fa` |
| Button active bg | `#e8f1fa` (blue tint) |
| Button active text | `#3170aa` |
| Node card background | per-type (e.g. `#e8f1fa` for boards, `#edfaf3` for lists) |
| Dot grid | `rgba(0,0,0,0.07)` |
| Outgoing sync badge bg | `#edfaf3` |
| Outgoing sync badge text | `#198754` |
| Ghost border/bar | `#7357ff` |
| Tooltip bg | `#1e2530` |
| Tooltip text | `#f0f4f8` |
| Outgoing sync badge bg | `#edfaf3` |
| Outgoing sync badge text | `#198754` |
| Ghost border/bar | `#7357ff` |
| Plan node color | `#7357ff` |
| Section node color | `#4f46e5` |
| Board node color | `#3170aa` |
| List node color | `#198754` |
| Card node color | `#5b687b` |

---

## Card / Node Label Resolution

### ✅ CONFIRMED correct resolution order:
1. `node.statement` — plain-text shorthand (set by CSV import, AI shorthand, manual entry)
2. `node.textDoc` (plain text extracted from `node.textDocId` rich-text document)
3. Fallback: `Card ${node.id}`

### Sources:
- `DataViz/Mappers/nodeMapper.ts:101`: `label: node.statement || node.textDoc`
- `serialize-list-to-text.ts:37`: `getNodeText(tx, node.textDocId) ?? node?.statement`
- `CardText.tsx:44`: `if (cardLength !== 'full' && node.statement) return node.statement`
- `C2Board/Unit/index.tsx:130`: `if (node.statement) return node.statement`

### ✅ CONFIRMED: `collab.global.getTitle('nodes', id)` IS BROKEN for nodes
- `get-title.ts` looks for `item.title ?? ''`
- Node objects have `statement`, not `title`
- Returns `''` always for nodes — every fallback using this was silently failing

### ✅ CONFIRMED: `getNodeText` extracts plain text from rich-text doc
```typescript
// get-node-text.ts
export const getNodeText = (tx, textDocId) => {
  const doc = tx.get('documents', textDocId);
  return textContent(doc.snapshot as DocNode);  // from bc-artifact-classification
};
```

### ✅ CONFIRMED: `collab.nodes` exposes these relevant functions:
- `getMany` — raw nodes, NO textDoc
- `getHydratedNode(nodeId)` — node + Document objects (deprecated)
- `getHydratedNodes(nodeIds)` — batch version
- `getBlendedNodes` — **UNKNOWN** what this returns; may include plain text

### ✅ CONFIRMED: `collab.documents` API:
- `collab.documents.getNodeDocument(nodeId)` → `Document | undefined` (looks up node then returns its textDoc)
- `collab.documents.getNodeText(textDocId)` → `string | undefined` (calls `textContent(doc.snapshot)` internally)
- `collab.documents.get(docId)` → via base methods — returns `Document | undefined`
- **Best pattern for card labels**: `await collab.documents.getNodeText(node.textDocId)` — no textContent import needed!

### ✅ CONFIRMED: `collab.documents.getNodeText` is the correct card label API
```typescript
// prosemirrorTextSerializer.ts uses this exact pattern:
const textDoc = await collab.documents.get(node?.textDocId);
if (textDoc?.snapshot) {
  const nodeDoc = Node.fromJSON(schemas.nodeText, textDoc.snapshot);
  return nodeDoc.textContent;
}
// OR simpler via collab.documents.getNodeText:
const text = await collab.documents.getNodeText(node.textDocId);
```

### ✅ CONFIRMED: `collab.c2_units.getTextContent(unitId)` is exposed
```typescript
// get-text-content.ts — returns { textDoc: Document | null, statement: string | undefined }
const unit = tx.get('c2_units', unitId);
const node = tx.get('nodes', unit.nodeId);
const statement = node?.statement ?? undefined;
const textDoc = tx.get('documents', node?.textDocId);
return { textDoc, statement };
```
- This is the CORRECT API for C2 unit label resolution
- Still need to call `textContent(textDoc.snapshot)` to extract plain text from `textDoc`

### ⚠️ ROOT CAUSE of JSON labels:
- `statement` field can contain a JSON artifact-key reference (`{"type":"nodes","id":X}`) instead of plain text
- This happens for manually created cards where content is in the rich-text doc
- Also: some cards have `statement: null` and content entirely in `textDocId`
- `collab.nodes.getMany` returns raw nodes — `textDoc` is NOT resolved
- Fix: use `textContent(doc.snapshot)` after loading `documents[node.textDocId]`

### ❓ STILL UNKNOWN:
- Does `collab.nodes.getBlendedNodes` return text-resolved nodes (plain text in `textDoc` field)?
- Can we import `textContent` from `bc-artifact-classification` in the exporter?

---

## Boards

### ✅ CONFIRMED boardType values:
| boardType | Export type | Notes |
|---|---|---|
| `''` (empty) | `board` | Default list board |
| `'cards'` | `board` | List board with cards |
| `'lists'` | `board` | List board (alt layout) |
| `'timeline'` | `timeline` | Timeline / sync matrix |
| `'c2'` | `c2board` | C2 diagram |
| `'map'` | `map` → upgraded to `cause_effect` if has edges | CausalMap or geographic overlay map |

### ✅ CONFIRMED C&E detection logic:
- `boardType = 'map'` = either C&E board OR geographic overlay map
- C&E boards have edges between their nodes in the brief's edge set
- Logic: if `boardType = 'map'` AND edges exist between board's native nodeIds → `cause_effect`
- Geographic overlay maps may also have edges (pins/overlays) — ambiguity remains

### ⚠️ C&E still showing as 'map' bug:
- Debug showed `Mission C&E` board with `boardType: 'map'` — upgrade SHOULD fire
- If the upgrade isn't working: either edges aren't being returned, or the board's nodeIds aren't in `boardDescendantNodes`
- C&E boards use `boardType='map'` so go through the NON-c2board path (lists/cards)
- BUT C&E boards may not have lists — they may be purely node+edge based
- If `getLists` returns empty for a C&E board, `descendantNodes` is empty → no edges match → no upgrade

### ✅ CONFIRMED: C&E boards use `board.nodeIds`, NOT lists
- `board.nodeIds` = direct node IDs on the board (not in any list)
- `board.listIds` = list-based cards (regular boards)
- C&E boards (`boardType='map'`) have nodes in `board.nodeIds`, `listIds` is empty/absent
- Fix: call `collab.boards.getNodes(boardId)` for `boardType='map'` boards to populate `boardDescendantNodes`
- Then edge detection fires correctly

### ✅ CONFIRMED: `collab.edges.getAll()` returns `Record<number, Edge>` keyed by edge ID
- `Object.values(allEdges)` to iterate
- Edge fields: `{ affirmative, briefId, sourceNodeId, targetNodeId, probGivenSource, probGivenNotSource }`
- `affirmative: true` → contributes; `false` → blocks

---

## Lists / Sections

### ✅ CONFIRMED list object fields:
```
{
  id, title, briefId, color,
  nodeIds: [{nodeId, children}],  // ordered card IDs with sub-cards
  createdAt, updatedAt,
  deleted, editable, artifactVersionId
}
```

- `briefId` = plan this list was CREATED in (canonical ownership)
- Cross-plan synced list: `list.briefId !== currentPlan.id`
- `nodeIds` = ordered array of `{nodeId, children}` — children are sub-cards
- `collab.lists.getNodeIds(listId)` → flat array of node IDs (ignores hierarchy?)

### ✅ CONFIRMED: `collab.lists.getNodeIds(listId)` returns FLAT array
- Calls `getManyListNodes` which uses `flattenTree(list.nodeIds)`
- Sub-cards ARE included — the entire node tree is flattened
- `list.nodeIds` is a tree of `{nodeId, children}[]` objects (hierarchical storage)
- `flattenTree` walks all levels and returns all nodeIds flat

### ✅ CONFIRMED: `node.primaryListId`
- The card's canonical home list (set on add, used for color + default sort)
- Cross-plan indicator: if the primary list belongs to another plan, the card is from there
- `null` for some nodes (timeline events, C&E nodes placed directly on board)

---

## Nodes / Cards

### ✅ CONFIRMED node object fields:
```
{
  id, briefId, statement,        // statement = plain-text shorthand (nullable/JSON)
  textDocId,                     // → Document with rich-text content
  notesDocId,                    // → Document with notes
  primaryListId,                 // canonical home list (null for some nodes)
  createdAt, updatedAt,
  syncId,                        // null on all nodes seen — purpose UNKNOWN
  unitFlags,                     // ["US","USA"] for military units
  unitRank,                      // military rank
  fields: {fieldId: [value]},   // custom field values
  icon: {geometry, properties},  // geospatial symbol
  fileDocumentId,                // attached file
  at, duration,                  // timeline positioning (ms)
  deleted, deletedMetadata
}
```

### ✅ CONFIRMED cross-plan detection:
- `node.briefId !== currentPlanId` → card is cross-plan synced into this plan
- `node.primaryListId` → card's home list (may differ from current list if synced)

### ✅ CONFIRMED types of cards:
- **CSV-imported**: `statement = "KPNS"` (plain text in statement)
- **Manually created**: `statement = null` OR `statement = '{"type":"nodes","id":X}'`, content in textDocId
- **Timeline cards**: `statement` + `at` (timestamp ms) + `duration`
- **Military unit cards**: `unitFlags: ["US","USA"]`, `unitRank`

### ❓ STILL UNKNOWN:
- What does `syncId` represent? When is it non-null?
- Sub-card hierarchy: how are nested cards (children in list.nodeIds) handled?

---

## C2 Units

### ✅ CONFIRMED c2_unit object fields:
```
{
  id,           // c2_unit ID (NOT the same as nodeId)
  nodeId,       // → underlying node ID (the actual card content)
  briefId,
  posX, posY, height, width,
  state, layout,   // layout = 'downwardFanout' etc.
  deleted
}
```

### ✅ CONFIRMED APIs:
- `collab.c2_units.getBoardUnits(boardId)` → array of c2_unit objects
- `collab.c2_units.getUnitNode(unitId)` → the unit's node (statement may be JSON ref)
- `collab.c2_units.getTextContent(unitId)` → `{textDoc: Document|null, statement: string|undefined}`

### ✅ CONFIRMED correct C2 label resolution:
```
const content = await collab.c2_units.getTextContent(unitId);
let label = content?.statement?.trim();
if (label?.startsWith('{')) label = '';
if (!label && content?.textDoc?.snapshot) {
  label = textContent(content.textDoc.snapshot);  // needs bc-artifact-classification import
}
label = label || `Unit ${unitId}`;
```

### ⚠️ Current exporter issue:
- `getUnitNode` returns node where `statement` is JSON ref → correctly skipped
- Fallback `getTitle('c2_units', id)` → returns `''` (no title field on c2_units)
- Fallback `getTitle('nodes', nodeId)` → also returns `''` (no title field on nodes)
- **All fallbacks fail** — label ends up as `Unit ${id}`
- Fix: use `getTextContent` + `textContent(doc.snapshot)` instead

### ❓ STILL UNKNOWN:
- C2 hierarchy: units have parent/child relationships (`getSubordinates`, `getParents`). Should these be represented as `contains` links in the export?
- Does `getTextContent` work when `statement` has a JSON value? Or only when null?

---

## Edges (C&E / contributes / blocks)

### ✅ CONFIRMED:
- `collab.edges.getAll()` returns ALL edges for the ENTIRE brief
- `Object.values(allEdges)` iterates them — they're returned as an object keyed by ID
- Edge fields: `{sourceNodeId, targetNodeId, affirmative, probGivenSource, probGivenNotSource}`
- `affirmative: true` → `contributes` link; `affirmative: false` → `blocks` link
- Edges are brief-scoped, NOT board-scoped — no `boardId` on edges

### ❓ STILL UNKNOWN:
- Do C&E boards (`boardType='map'`) put their nodes in lists, or are nodes placed directly on the board without lists?
- If no lists → `descendantNodes` stays empty → C&E upgrade never fires

---

## Cross-Plan Sync

### ✅ CONFIRMED canonical cross-plan signal:
- `record.briefId !== currentPlanId` on any record (node, list, board, section)
- This is the ONLY reliable cross-plan indicator
- Available on: nodes, lists, boards (confirmed from debug)

### ✅ CONFIRMED removed from exporter:
- `getUsedInArtifacts` calls → removed (returned same-plan consumers, not cross-plan signal)
- All `syncs` link type emissions → removed

### ✅ CONFIRMED: Outgoing cross-plan sync detection (Phase 7)

Detects when a card created in the CURRENT plan is also synced INTO other plans. Runs after all boards/lists are processed.

```typescript
// Phase 7 in getArtifactMapData.ts
const nativeCardArtIds = artifacts
  .filter(a => a.type === 'card' && (a.sourceBriefId == null || a.sourceBriefId === briefId));

for (const art of nativeCardArtIds) {
  const numId = parseInt(art.id.replace('nodes_', ''), 10);
  const allListIds = await collab.nodes.getListIds(numId);
  const otherPlanBriefIds: number[] = [];
  for (const listId of allListIds) {
    const ls = await collab.lists.getMany([listId]);
    const listBriefId = (ls as any)?.[0]?.briefId;
    if (listBriefId != null && listBriefId !== briefId) {
      otherPlanBriefIds.push(listBriefId);
    }
  }
  if (otherPlanBriefIds.length > 0) {
    art.syncedToOtherPlans = true;
    art.syncedPlanBriefIds = otherPlanBriefIds;
  }
}
```

- `collab.nodes.getListIds(nodeId)` returns ALL list IDs across ALL plans the node appears in
- For each list, check `list.briefId !== currentBriefId` to confirm it's in another plan
- Result fields on `ArtifactRecord`: `syncedToOtherPlans: boolean`, `syncedPlanBriefIds: number[]`
- Rendered as `↗S` teal badge (top-right corner) on the Canvas node
- Sidebar shows "SYNCED TO OTHER PLANS → ↗ Live in N other plans" when selected

### ❓ `syncId` on nodes — UNKNOWN purpose:
- Seen as `null` on all nodes in debug
- May be a cross-plan sync identifier when non-null
- Needs investigation

---

## Global Title API (getTitle)

### ✅ CONFIRMED implementation:
```typescript
export const getTitle = (tx, type, id): string => {
  const item = tx.get(type, id);
  if (TYPES_WITH_NAME.includes(type)) return item.name ?? '';
  return item.title ?? '';
};
```

### ✅ Works for (have `.title` field):
`boards`, `maps`, `whiteboards`, `presentations`, `file_documents`, `documents`, `orders`

### ⚠️ Works synchronously only (misses uncached items):
- `sections` → has `.title` field in theory, BUT `tx.get('sections', id)` only hits the local synchronous store — if the section was never pre-loaded in this browser session it returns `undefined`
- **Fix**: use `collab.lists.getMany([listId])` (async, force-loads) → `(ls as any)?.[0]?.title`

### ✅ Does NOT work for:
- `nodes` → have `.statement` not `.title` → always returns `''`
- `c2_units` → no `.title` field → always returns `''`

---

## Section Tree

### ✅ CONFIRMED: `collab.briefs.getNestedStructure()` returns:
Nested `SectionTree[]` with `{type, id, children}`. Types seen:
`boards`, `maps`, `whiteboards`, `presentations`, `file_documents`, `documents`, `orders`, `sections`

### ❓ STILL UNKNOWN:
- Do section tree nodes have `briefId`? (assumed yes based on Notion docs, unconfirmed in debug)
- Do boards in section tree always appear at top level, or can they be nested?

---

## Viewer (ArtifactMapEngine)

### ✅ Current state:
- Canvas 2D rendering
- Tier-based layout: plan(5) → output products(4) → visual tools(3) → list boards(2) → lists(1) → cards(0) → references(-1)
- **Card duplication**: cards appear under EVERY list they're in via visual IDs (`cardId⊕listId`). Clicking any instance selects the canonical card and highlights all instances + all connections.
- Card stacking: max 10 per column, max 3 columns per row, then wraps to next row group (CARD_ROW_GAP=70)
- Ghost detection: seenInPlans + sourceBriefId → ghost copies in destination plan; native version always preferred regardless of JSON load order
- Ghost rendering: purple dotted border, full opacity (not faded), `↗` prefix on type label
- Source plan artifacts: NO visual indicator for x-plan sync (completely normal appearance)
- BFS highlight: canonical IDs resolved via `canonicalOf`. For virtual card nodes (`cardId⊕listId`), the instance is only lit if the parent listId is ALSO in the highlighted set — prevents cards in sibling lists from lighting up when you click one list.
- **Selection modes**: `bfsBidirectional()` — normal click — goes ALL the way up (every ancestor to plan) in Phase 1 then ALL the way down (every descendant to cards) in Phase 2, independent passes. `bfsImpact()` — ⚡ Impact button — upward only; follows `contains`/`pins` as targets upward, `ghost` links forward (sync copies are impacted), does NOT descend. `cardCascade()` has been removed.
- **Focus view**: uses same CARD_STACK_MAX/MAX_COLS_PER_ROW stacking as main view; cards placed at canonical IDs (no virtual ⊕ duplicates — nexus node approach); first list to claim a card places it, subsequent lists skip it so the card appears once; higher-tier nodes centered above list/card block; orphan nodes (reachable only via `pins`, not `contains`) centered within layout bounds at their correct tier Y; fit-view uses `Object.keys(focusNodePos)` for bounding box.
- **Dot grid**: `drawDotGrid()` renders 1px dots at 30px world-space intervals on both main and focus canvases.

### Visual ID system:
- Cards under lists (main view only): `cardId + '⊕' + listId` → `canonicalOf[vId] = cardId`
- `primaryVisualOf[cardId]` = first visual ID (used for link targeting)
- `effPos(id)` = canonical nodePos OR primary visual pos
- `containPos(srcId, tgtId)` = specific visual pos of tgtId under srcId (looks up `tgtId⊕srcId` first)
- **Focus view does NOT use virtual ⊕ IDs** — `focusLayout = true` flag makes `layoutList` place cards at their canonical ID. First list to process a card places it; subsequent lists that share the same card skip placement (the card becomes a nexus node). All `contains` arrows still route to the single canonical position via `containPos()` fallback.
- **Why nexus in focus**: prevents the same card appearing as a separate node per-list in focus view; instead it appears once with all parent lists connecting to it.
- **Main view**: each card appears N times (once per list via virtual ⊕ IDs) to show multiplicity; focus view collapses them to the canonical ID.

### Connection anchors and arrow direction (direction-aware routing):

`drawEdge()` calculates `dy = (tgt.y + NODE_H/2) - (src.y + NODE_H/2)` and `useVertical = Math.abs(dy) > NODE_H * 0.75` to choose routing mode:

- **`contains` links** — always vertical: child top-center → parent bottom-center; arrowhead at parent bottom (arrows point UPWARD into parent). Plan only receives; cards only emit.
- **`pins` / `ghost` / `sourced_from` — `useVertical && dy >= 0`** (src above tgt): exit src **bottom-center**, enter tgt **top-center**; arrowhead at tgt top.
- **`pins` / `ghost` / `sourced_from` — `useVertical && dy < 0`** (src below tgt): exit src **top-center**, enter tgt **bottom-center**; arrowhead at tgt bottom.
- **`pins` / `ghost` / `sourced_from` — parallel** (same tier, `useVertical = false`): exit src **left or right** side, enter tgt opposite side based on relative X; arrowhead at tgt side.

This means all arrows correctly enter/exit from the edge facing the direction of travel regardless of link type.

### Ghost mechanism — architecture detail (CRITICAL):

When both plans are loaded, `mergeAndRender()` runs the ghost loop then a Phase 2 expansion:

**Why ghost sections need Phase 2:**
- `processSectionTree` skips `boards` nodes and processes their children directly under the PLAN → emits `contains: plan_X → sections_15` (NOT `contains: board → sections_15`)
- `processListBoard` then emits `contains: sections_15 → cards` (same link in both plan exports → deduplicated to ONE link after merge)
- Ghost loop for `sections_15`: finds `contains: plan_2 → sections_15` link → creates `sections_15__ghost__plan_2` correctly ✓
- Ghost loop for cards under sections_15: finds `contains: sections_15 → nodes_42` but `sections_15.plan = 'plan_1' = nativePlanId` → SKIPS → no ghost cards created ✗

**Phase 2 ghost expansion** (runs after main ghost loop, before computeLayout):
- Iterates all `isGhost` artifacts created by the main loop
- For each ghost LIST: finds `contains: canonId → cardId` links in the pre-expansion link snapshot → creates ghost cards and `contains: ghostListId → ghostCardId` links
- For each ghost artifact: mirrors `pins: canonId → X` links as `pins: ghostId → X__ghost__planId` (when the target also has a ghost in the same plan)
- This creates the full ghost subtree: ghost board → ghost sections → ghost cards, all in the destination plan

**Why ghost boards have no children via contains:**
- The ghost board (`boards_5__ghost__plan_2`) gets NO children from the contains structure because `boards_5 → sections_15` is a PINS link (not contains). The sections are DIRECT children of `plan_2` via contains.
- The ghost board IS connected to ghost sections via the mirrored PINS links (from Phase 2 expansion).
- In `layoutPlan('plan_2')`: ghost board goes to tier3, ghost sections to tier1 (as direct plan children), ghost cards to tier0 — same visual structure as the native plan.

### Selection modes — bfsBidirectional and bfsImpact

**`bfsBidirectional(startId)`** — normal click:
- Phase 1 (upward): follows `contains` (as target), `pins` (as target), `ghost` (as target), `sourced_from` (as target) — goes ALL the way to plan
- Phase 2 (downward): follows `contains` (as src), `pins` (as src) — goes ALL the way to cards
- Phases are independent; going down from startId does NOT trigger another upward pass

**`bfsImpact(startId)`** — ⚡ Impact mode:
- Follows `contains`/`pins` UPWARD (target → src direction)
- Follows `ghost` FORWARD (src → tgt direction) — sync copies of a changed artifact are also impacted
- Follows `sourced_from` UPWARD (tgt → src direction)
- Does NOT descend at all

### buildFocusLayout() — key design rules:
1. **Saves and restores** `tierY`, `nodePos`, `canonicalOf`, `primaryVisualOf` around focus pass — focus layout never corrupts main canvas state
2. Sets `focusLayout = true` before layout pass; `layoutList` checks this flag to skip virtual ⊕ IDs (nexus mode) — unsets to `false` after
3. Re-runs full layout algorithms (`layoutPlan`/`layoutSection`/`layoutBoard`/`layoutList`) scoped to focused nodes only — produces a compact isolated view, not a sub-window of the main canvas
4. Stores results in `focusCanonicalOf` / `focusPrimaryVisualOf` (not the main fields)
5. **Orphan centering**: nodes not reachable via `contains` in the focus set (e.g. maps/presentations connected only via `pins`) are grouped by tier and centered within the existing layout X bounds rather than appended to the right
6. `renderFocus` swaps `canonicalOf = focusCanonicalOf` and `primaryVisualOf = focusPrimaryVisualOf` before calling `drawScene`, restores after
7. `hitTest` in focus canvas mouse handler passes `focusCanonicalOf` as `overrideCanonicalOf`
8. `computeFocusTierY` maps tiers to compact Y spacing (tier gaps ~90px vs ~140px in main)
9. `openFocus()` calls `computeFitView(focusCanvas, focusNodePos, Object.keys(focusNodePos))` not `focusNodeIds`

---

## Known Bugs & Status

| Bug | Status | Fix |
|---|---|---|
| Card JSON labels (`{"type":"nodes","id":X}`) | ✅ Fixed | Phase 1 emits real title from `collab.global.getTitle('nodes', id)` + node.statement fallback |
| C2 unit labels show as `Unit X` | ✅ Fixed | processC2Board uses `c2unit.label ?? c2unit.title ?? getTitle fallback` |
| C&E upgrade not firing | ✅ Fixed | Phase 6 checks cross-node edges via `board.edges` property directly, not via descendantNodes |
| Ghost detection inverted | ✅ Fixed | Replaced syncs-based with seenInPlans + sourceBriefId |
| Cards in single column | ✅ Fixed | 10 per col, 3 cols/row, wraps to new row group |
| Deep dive highlights everything | ✅ Fixed | BFS caps contains-upward at depth 2, no card cascade |
| X-plan sync source plan shows teal dot | ✅ Fixed | Removed syncedToOtherPlans indicator entirely |
| Ghost nodes faded/shaded | ✅ Fixed | Full opacity, purple dotted border only |
| Reference docs under wrong plan | ✅ Fixed | emitSourceDocLink checks nodeBriefId before emitting contains |
| Map → card connections missing | ✅ Fixed | Phase 5.5: `feature.properties.nodeId ?? feature.properties.user_nodeId` |
| Cards not shown under every list | ✅ Fixed | Visual ID duplication system (cardId⊕listId) |
| List label shows "List 7" instead of real title (processSectionTree) | ✅ Fixed | `collab.lists.getMany([listId])` (async) instead of `collab.global.getTitle('sections', id)` (sync, misses uncached) |
| List label shows "List 7" from processListBoard (list.title empty) | ✅ Fixed | Fallback: if `list.title` empty, try `collab.lists.getMany([list.id])` before using `List ${id}` default |
| X-plan sync: cross-plan artifacts placed in wrong column | ✅ Fixed | Prefer native version (`sourceBriefId === planId`) regardless of JSON load order in `mergeAndRender()` |
| Orders → list connections missing (WARNO) | ✅ Fixed | `order.docId` → `getListTablePmNodesData(docId)` instead of `getListTablePmNodesData(orderId)` |
| Map overlay → list pins missing | ✅ Fixed | Phase 5.5 extended: `feature.properties.listId ?? feature.properties.user_listId` → emits `pins` link from map to list |
| Focus view cards in one infinite horizontal row | ✅ Fixed | `buildFocusLayout()` rewritten with CARD_STACK_MAX stacking + virtual ⊕ IDs |
| Highlighting doesn't cascade to cards inside highlighted lists | ✅ Fixed | `cardCascade()` applied in `getHighlightedNodes()` for all modes |
| Ghost sections show in destination plan with no cards beneath them | ✅ Fixed | Phase 2 ghost expansion in `mergeAndRender()` creates ghost cards under ghost sections |
| Ghost boards disconnected from their ghost sections visually | ✅ Fixed | Phase 2 expansion mirrors canonical `pins: board → list` as `pins: ghostBoard → ghostSection` |
| Ghost card virtual IDs invisible in focus view | ✅ Fixed | `buildFocusLayout()` sets `canonicalOf[vId] = listCards[i]` for all new virtual IDs so ghost items resolve in `drawScene` |
| Presentations showing 0 connected lists/cards | ✅ Fixed | 5 fixes in `getArtifactMapData.ts` — see "getArtifactMapData Bug Fixes" section below |
| Documents showing 0 connected lists/cards | ✅ Fixed | Same 5-fix batch — list-table key fallbacks + node-embed scanning |
| Lists/cards floating directly under plan instead of their board | ✅ Fixed | Early phases (widgets, docs, orders, map overlays) were prematurely setting `primaryParent` → Phase 5 saw list already parented and emitted `pins` instead of `contains`. Fix: early phases only `emitArtifact` + `pins`, never set `primaryParent`. Phase 5.9 fallback assigns plan for any remaining orphans. |
| Clicking a list highlights same card in ALL lists it belongs to | ✅ Fixed | Virtual node `cardId⊕listId` — check that `parentListId` is also in highlighted set before lighting up the instance |
| `contains` arrows pointing downward | ✅ Fixed | Swapped src/tgt in `drawEdge` for contains: line runs child-top → parent-bottom with arrowhead at parent |
| Focus view shows full canvas instead of compact isolated layout | ✅ Fixed | `buildFocusLayout` now re-runs full layout algorithms scoped to focused nodes with `computeFocusTierY`; saves/restores main state |
| Orders loop failing to find PM content | ✅ Fixed | Use `docRecord.snapshot ?? docRecord` directly from `collab.documents.get(docId)` — confirmed `snapshot` key holds the PM doc |
| Focus view orphan nodes placed far to the right (spacing) | ✅ Fixed | `buildFocusLayout` now centers orphans (nodes reachable only via `pins`) within existing layout X bounds, grouped by tier |
| Focus view shows same card once per list instead of merged | ✅ Fixed | `focusLayout = true` flag makes `layoutList` skip virtual ⊕ IDs; first list places the card canonically, subsequent lists reuse it (nexus node) |
| `pins`/`ghost`/`sourced_from` arrows always use left/right routing | ✅ Fixed | `drawEdge` now uses direction-aware routing: vertical top/bottom when nodes are on different tier rows; left/right only when parallel (same tier) |

---

## getArtifactMapData Bug Fixes (Presentation/Document Connections)

Five fixes applied to `getArtifactMapData.ts` Phase 3 (widget/document processing):

### Fix 1: `list-table` widget config key
`config.listId` may be undefined; the actual key is `config.sectionId` on some widget versions.
```typescript
// Before:
const listId = cfg.listId as number | undefined;
// After:
const listId = (cfg.listId ?? cfg.sectionId) as number | undefined;
```

### Fix 2: Node-embed widget fallback
After the `switch` for known widget types, a fallback block handles any widget with `cfg.nodeId` (card embed) or `cfg.listId`/`cfg.sectionId` (list embed):
```typescript
if (!embeddedId) {
  const nodeId = Number(cfg.nodeId ?? cfg.artifactNodeId ?? 0);
  if (nodeId) {
    // emit card + pins link; continue
  }
  const listId2 = Number(cfg.listId ?? cfg.sectionId ?? 0);
  if (listId2) {
    // emit list + pins link; continue
  }
}
```

### Fix 3: Presentation slides — `slide.elements` fallback
`getSlides` returns slides where widgets may live at `slide.widgets` OR `slide.elements`:
```typescript
const widgets = slide?.widgets ?? slide?.elements ?? [];
if (widgets.length) await processWidgets(widgets, artId);
```

### Fix 4: `emitListTableLinks` — triple-key fallback
The PM node data entry may store the list ID at different keys:
```typescript
const listId = (e?.settings?.listId ?? e?.listId ?? e?.sectionId) as number | undefined;
```

### Fix 5: Document inline card embeds via `getNodeEmbedPmNodesData`
After scanning `list_table` nodes, also try scanning for `node_embed` PM blocks:
```typescript
const nodeEmbeds = await (collab.documents as any).getNodeEmbedPmNodesData?.(docId);
if (nodeEmbeds) {
  for (const entry of Object.values(nodeEmbeds as any)) {
    const nodeId = Number(e?.nodeId ?? e?.settings?.nodeId ?? 0);
    // emit card + pins link
  }
}
```

---

## Board Processing Summary (DEFINITIVE)

| boardType | Display type | How to get cards |
|---|---|---|
| `'c2'` | `c2board` | `collab.c2_units.getBoardUnits(boardId)` |
| `'map'` (no edges) | `map` | `collab.boards.getNodes(boardId)` → board.nodeIds |
| `'map'` (has edges) | `cause_effect` | `collab.boards.getNodes(boardId)` → board.nodeIds |
| `'timeline'` | `timeline` | `collab.boards.getLists(boardId)` → per list: `collab.lists.getNodeIds(listId)` |
| `''` / `'cards'` / `'lists'` | `board` | `collab.boards.getLists(boardId)` → per list: `collab.lists.getNodeIds(listId)` |

**Rule**: Timeline boards store events in LISTS (with `at`/`duration` fields on the nodes), NOT in `board.nodeIds`. Only C2 and map boards use `board.nodeIds` directly.

### ✅ CONFIRMED: Shared lists across multiple boards — `pins` vs `contains`
- The same section list can appear in multiple boards (e.g. Phase I-IV lane lists in Sync Mat timeline AND Demo Board cards board)
- First board to process the list gets `contains` ownership (`primaryParent` map)
- Subsequent boards that encounter the same list get a `pins` link instead
- Pattern in `processListBoard`:
```typescript
if (!primaryParent.has(listArtId)) {
  primaryParent.set(listArtId, boardArtId);
  emitLink({ type: 'contains', src: boardArtId, tgt: listArtId });
} else {
  emitLink({ type: 'pins', src: boardArtId, tgt: listArtId });
}
```
- Real example: Sync Mat timeline has Phase I-IV as lanes; Demo Board also uses those same lists as its columns → Demo Board "owns" them, Sync Mat gets `pins` (or vice versa depending on processing order)

---

## Cross-Plan Syncing (DEFINITIVE)

### How it works:
1. A node is created in plan A (`node.briefId = planA.id`)
2. User syncs it into plan B — the node ID appears in plan B's list `nodeIds` array
3. The node object's `briefId` STAYS as planA — it is the ONLY reliable ownership signal
4. `collab.nodes.getListIds(nodeId)` returns ALL lists across ALL plans the node appears in

### Detection in exporter:
- `node.briefId !== currentBriefId` → this card was created in another plan
- `list.briefId !== currentBriefId` → this list was created in another plan  
- `board.briefId !== currentBriefId` → this board was created in another plan
- These are the ONLY signals — `getUsedInArtifacts`, `getSyncedCount` are NOT cross-plan signals

---

## `collab.nodes` Full API

```typescript
collab.nodes.get(nodeId)                    // base method, sync but awaitable
collab.nodes.getMany(ids)                   // NodeSavedType[] — no textDoc
collab.nodes.getAll()                       // all nodes in brief
collab.nodes.getListIds(nodeId)             // all list IDs containing this node (ALL plans)
collab.nodes.getMapOverlaysWithNode(nodeId) // MapOverlay[] that contain this node
collab.nodes.getNodeFeaturesInOverlays(nodeId) // {id: overlayId, features[]}[]
collab.nodes.getEdges(nodeId)               // edges connected to this node
collab.nodes.areAnyCrossplan(ids)           // any node.briefId !== tx.briefId
collab.nodes.getListsMetadata(ids)          // list metadata for nodes
collab.nodes.getListsForNodes(ids)          // lists for multiple nodes
collab.nodes.getBlendedNodes(boardId)       // deprecated, uses getHydratedNode
collab.nodes.getHydratedNode(nodeId)        // deprecated, returns node+textDoc+notesDoc
```

---

## Map Pins (DEFINITIVE approach — Phase 5.5)

### ✅ CONFIRMED: `getOverlays` source
```typescript
// get-overlays.ts
export const getOverlays = (tx, mapId, excludeOverlayIds?) => {
  const map = tx.get('maps', mapId);
  const overlayIds = (map.overlayIds ?? []).filter(...);
  return overlayIds.map((id) => tx.get('map_overlays', id)).filter(truthy);
};
```
Returns raw `MapOverlay[]` objects (the OT document itself).

### ✅ CONFIRMED: Node ID field on map overlay features
- Card/node references are at **`feature.properties.nodeId`** (NOT `feature.nodeId` or `feature.cardId`)
- Fallback: `feature.properties.user_nodeId` (legacy field)
- Source: `cleanFeatureForUpdate.ts:42` and `listFeatureApi.ts:106,177`

### ✅ CONFIRMED working Phase 5.5 implementation (async overlay loading):
```typescript
for (const [mapNumericId, mapArtId] of discoveredMaps) {
  try {
    const map = await (collab.maps as any).get(mapNumericId);
    for (const overlayId of (map as any)?.overlayIds ?? []) {
      try {
        const overlay = await (collab as any).map_overlays?.get(overlayId);
        for (const feature of (overlay as any)?.features ?? []) {
          const props = (feature as any).properties;
          const cardNumId = props?.nodeId ?? props?.user_nodeId;
          if (!cardNumId) continue;
          const cardArtId = makeId('nodes', cardNumId);
          if (emittedArtifacts.has(cardArtId)) {
            emitLink({ type: 'pins', src: mapArtId, tgt: cardArtId });
          }
        }
      } catch { }
    }
  } catch { }
}
```

### ⚠️ IMPORTANT: `getOverlays` is synchronous — reads pre-cached data only
- `collab.maps.getOverlays(mapId)` calls `tx.get('map_overlays', id)` synchronously from the local store
- If `map_overlays` OT documents weren't pre-loaded in the session, they return `undefined`
- **Fix**: use `collab.maps.get(mapId)` → iterate `map.overlayIds[]` → `collab.map_overlays.get(overlayId)` (async, force-loads)
- Previous broken approach used sync `getOverlays` which returned empty array for uncached overlays

### ✅ CONFIRMED: Phase 5.5 now handles BOTH card pins AND list pins from overlay features:
```typescript
for (const feature of (overlay as any)?.features ?? []) {
  const props = (feature as any).properties;
  const cardNumId = props?.nodeId ?? props?.user_nodeId;
  const listNumId = props?.listId ?? props?.user_listId;

  if (cardNumId) {
    const cardArtId = makeId('nodes', cardNumId);
    if (emittedArtifacts.has(cardArtId)) {
      emitLink({ type: 'pins', src: mapArtId, tgt: cardArtId });
    }
  }
  if (listNumId) {
    const listArtId = makeId('sections', listNumId);
    if (!emittedArtifacts.has(listArtId)) {
      let label = `List ${listNumId}`;
      try { const ls = await collab.lists.getMany([listNumId]); label = (ls as any)?.[0]?.title || label; } catch {}
      emitArtifact({ id: listArtId, type: 'list', label, plan: planArtId });
      if (!primaryParent.has(listArtId)) {
        primaryParent.set(listArtId, planArtId);
        emitLink({ type: 'contains', src: planArtId, tgt: listArtId });
      }
    }
    emitLink({ type: 'pins', src: mapArtId, tgt: listArtId });
  }
}
```

### ✅ CONFIRMED: Map overlay features index BOTH nodes AND lists (from `mapOverlayIndexer.ts`):
```typescript
const getProp = (feat, prop) => feat.properties?.[`user_${prop}`] ?? feat.properties?.[prop];
// For each feature:
const nodeId = getProp(feat, 'nodeId');   // → ['nodes', nodeId]
const iconId  = getProp(feat, 'iconId');  // → ['icons', iconId]
const listId  = getProp(feat, 'listId');  // → ['lists', listId] ← !! maps can also pin lists
```
- `user_nodeId` / `nodeId` → pins a card
- `user_listId` / `listId` → pins a list (new finding — exporter now handles this)

---

## Artifact Index (DEFINITIVE) — `bc-artifact-index` package

The artifact index is the ground truth for all containment relationships in Onebrief. Every indexer produces `[type, id][]` tuples representing direct children.

### `widgetIndexer.ts` — Widget → direct children
```
widget.nodes[*].nodeId          → ['nodes', nodeId]       (canvas card)
widget.docId                    → ['documents', docId]
widget.config.boardId           → ['boards', boardId]      (timeline/c2/grid embeds)
widget.config.mapId             → ['maps', mapId]          (map embed)
widget.type==='map': overlays[] → ['map_overlays', id]     (map widget also indexes overlays directly)
widget.type==='whiteboard'|'frames': config.contentId → ['frames', contentId]
widget.type==='list-table': config.listId → ['lists', listId]  ✅
widget.type==='image': attachmentId → ['attachments', id]
widget.config.nodeId (any type) → ['nodes', nodeId]        (single-card embed fallback)
```

### `whiteboardIndexer.ts` — Whiteboard → direct children
- Runs `widgetIndexer` for each widget in `whiteboard.widgets[]`

### `presentationSlideIndexer.ts` — Slide → direct children
- Runs `widgetIndexer` for each widget in `slide.widgets[]`
- Also: `slide.presenterNotesDocId` → `['documents', presenterNotesDocId]`
- **⚠️ NOTE**: In runtime data, widgets may be at `slide.elements` instead of `slide.widgets` — always try both: `slide?.widgets ?? slide?.elements ?? []`

### `boardIndexer.ts` — Board → direct children
- If `boardType === 'timeline'` → delegates to `timelineIndexer`
- Else: `board.nodeIds[]` → `['nodes', id]`; `board.listIds[]` → `['lists', id]`; `board.artifactIds[]` → `[type, id]`

### `listIndexer.ts` — List → direct children
- `list.nodeIds[]` (top-level only) → `['nodes', branch.nodeId]`

### `mapOverlayIndexer.ts` — Overlay → direct children (see above)

### `orderIndexer.ts` — Order → direct children
```
order.docId → ['documents', docId]
```
**CRITICAL**: Orders don't contain PM content directly — they have a `docId` pointer to a `documents` OT object. To find lists embedded in a WARNO: `order.docId` → load that document → walk its PM snapshot.

### `documentIndexer.ts` — Document → direct children (walks PM snapshot)
Documents contain inline artifacts as ProseMirror node types:
```
list_table    → config.listId  → ['lists', listId]
card_list     → config.listId  → ['lists', listId]   (different PM node, same result)
card          → config.nodeId  → ['nodes', nodeId]
node_embed    → config.nodeId  → ['nodes', nodeId]   (inline card embed — same as card)
c2_chart      → config.boardId → ['boards', boardId]
c2_chart_to_text → config.boardId → ['boards', boardId]
timeline      → config.boardId → ['boards', boardId]
whiteboard    → config.contentId → ['frames', contentId]  OR config.whiteboardId → ['whiteboards', id]
map_composition → config.mapId → ['maps', mapId]; config.overlayIds[] → ['map_overlays', id]
```
- So documents/orders (via docId) can embed: lists, individual cards, boards (timelines, C2), maps, whiteboards
- Our exporter handles `list_table` via `getListTablePmNodesData` and `node_embed` via `getNodeEmbedPmNodesData`

### Key relationship: WARNO → lists
```
orders_2 (order OT) → order.docId → documents_X → documents_X.snapshot → PM node list_table → listId
```
Fix in exporter: `collab.orders.get(orderId).docId` → then `getListTablePmNodesData(docId)`

---

## "Synced In" — What the Sync Summary Actually Shows (DEFINITIVE)

### What `getSyncedArtifacts(screen)` returns:
1. Get all descendant keys of the screen via `getChildKeys(index, screen, boardType)`
2. Filter to `SyncableArtifactTypes`: `['boards', 'nodes', 'lists', 'presentations', 'orders', 'maps', 'map_overlays', 'whiteboards', 'sections', 'frames']`
3. For each child, call `getUsedInArtifacts` → count of "screens" (non-timeline boards, maps, whiteboards, presentation_slides) that contain this artifact
4. Include if `usedIn >= 1`

### What the Sync Summary Badge shows:
- `calculateSyncedCount`: includes artifacts where `usedIn > 1 OR count > 1`
- `usedIn > 1` = artifact appears in 2+ PAGE_ARTIFACT containers
- `count > 1` = artifact appears 2+ times inside this single container
- Categories: `lists`, `cards` (nodes), `embeds` (everything else)

### CRITICAL: Timeline boards are EXCLUDED as containers for lists
- `getUsedInArtifacts` for a list explicitly returns `false` for timeline boards
- So Phase I-IV lists: `getUsedInArtifacts` only counts Demo Board (the cards board), NOT Sync Mat (timeline)
- `usedIn = 1` → NOT shown in Sync Summary unless they're also in a whiteboard/presentation widget

### `getChildKeys` logic — what counts as "inside" a screen:
- `isRootArtifact`: artifact's parent IS the screen (direct child)
- `isValidDocument`: a document whose parent-lineage doesn't include another artifact
- `isValidC2`: c2_units when screen is a c2 board
- `isValidMap`: map_overlays when screen is a map
- `isValidList`: lists when screen `boardType === 'cards'` — NOT timelines!

### Cross-plan detection (confirmed from `crossPlanExtension`):
- Scans ALL loaded artifacts in the datastore for `artifact.briefId !== currentBriefId`
- These are artifacts "from another plan" that were synced into the current plan
- Detection signal: `briefId !== currentBriefId` ✅ (same as our exporter uses)

### `SyncableArtifactTypes` (confirmed from `constants.ts`):
`['boards', 'nodes', 'lists', 'presentations', 'orders', 'maps', 'map_overlays', 'whiteboards', 'sections', 'frames']`

---

## Widget Types (DEFINITIVE)

Whiteboards and presentation slides both use `withWidgetSupport` — both store embedded tools in `widget[]` on the artifact object.

| widget.type | Config field | References | Notes |
|---|---|---|---|
| `map` | `config.mapId` | `maps` | geographic or overlay map |
| `timeline` | `config.boardId` | `boards` (boardType=timeline) | timeline board embed |
| `c2` / `comrel` | `config.boardId` | `boards` (boardType=c2) | C2/comrel board embed |
| `whiteboard` | `config.whiteboardId` + `config.contentId` | `whiteboards` + `frames` | whiteboard frame embed |
| `list-table` | `config.listId` **or `config.sectionId`** | `sections` | ✅ **direct list reference** — try both keys |
| `list` | (none — legacy) | — | LEGACY, not created anymore, ignore |
| `frames` | `config.contentId` | `frames` | internal whiteboard frame boundary |
| `grid` | `config.boardId` (optional) | `boards` | board table view (not currently handled) |
| `card` | `widget.nodes[0].nodeId` | `nodes` | direct card placement on canvas |
| *(any)* | `config.nodeId` or `config.artifactNodeId` | `nodes` | **fallback**: single-card embed when type not recognized |
| *(any)* | `config.listId` or `config.sectionId` | `sections` | **fallback**: list embed when type not recognized |

### ✅ CONFIRMED: `list-table` widget is how presentations/whiteboards reference lists
- `config.listId` is a `sections` ID (same OT type as boards' lists)
- **⚠️ Key may be `config.sectionId` instead** — always check both
- This is the source of "1 list" / "4 lists" shown in the Sync Summary UI
- The `getListTablePmNodesData` approach is ONLY for ProseMirror `list_table` NODES inside documents/orders

### ✅ CONFIRMED: "4 lists" in Sync Summary for presentations = timeline lane sections
- Presentation (Mission Brief) can show "4 lists" in Sync Summary
- This does NOT mean the presentation has 4 `list-table` widgets on its slides
- It means the presentation embeds a timeline (Sync Mat) via a `timeline` widget, and Sync Mat has 4 lane lists (Phase I-IV)
- The Sync Summary counts ALL transitively reachable lists, not just direct `list-table` widgets
- Direct `list-table` widgets on presentation slides DO create direct `pins` links to those lists

### ✅ CONFIRMED: Presentation API
- `collab.presentations.getSlides(presId)` → returns `PresentationSlide[]` (undeleted, non-hidden)
- Each slide has `widgets[]` (via `withWidgetSupport('presentation_slides', ...)`)
- **⚠️ Runtime slides may use `slide.elements` instead of `slide.widgets`** — always: `slide?.widgets ?? slide?.elements ?? []`
- Presentations have `slideIds[]` on the artifact; slides are stored as `presentation_slides` OT type
- `collab.presentation_slides.getWidgets(tx, slideId)` also works but `getSlides` is simpler

### ✅ CONFIRMED: Whiteboard API  
- `collab.whiteboards.get(wbId)` returns whiteboard with `widgets[]`
- `collab.whiteboards.getWidgets(tx, wbId)` also works
- `collab.whiteboards.getWhiteboardWidgetDocuments(wbId)` → `Document[]` from widgets with `docId`

### ❌ CONFIRMED NOT WORKING: Browser console collab access
- `window.collab` is NOT defined
- `window.collabSettled` exists but is a Promise/settled flag, not the API
- No `window.*` key exposes the collab API directly
- Do not attempt browser console debugging of collab API structure

---

## Remaining Searches Needed

### Still unknown (lower priority):
```bash
# Full base-methods wrapping behavior (how async works)
cat /root/repos/bc/packages/bc-collab/src/api/base-methods.ts | tail -80
```

```bash
# How sections contain child artifacts
cat /root/repos/bc/packages/bc-collab/src/api/sections/get-child-artifacts.ts
cat /root/repos/bc/packages/bc-collab/src/api/sections/get-count-of-children-synced-outside.ts
```

```bash
# C2 hierarchy — getParents API
cat /root/repos/bc/packages/bc-collab/src/api/c2_units/get-parents.ts
```

```bash
# Orders type definition
cat /root/repos/bc/packages/bc-collab/src/api/orders/types.ts
```

```bash
# Timeline boards - do they use lists or board.nodeIds for lanes/events?
cat /root/repos/bc/packages/bc-collab/src/api/boards/timeline/get-timeline-groups.ts
grep -rn "board\.nodeIds\|listIds" /root/repos/bc/packages/bc-collab/src/api/boards/timeline --include="*.ts" | head -10
```

---

## Maps / Overlays / Pins

### ✅ CONFIRMED: Map structure
- `map.overlayIds[]` — array of map_overlay IDs belonging to this map
- Each overlay has `features[]` where features with `properties.markerType === 'card'` are card pins
- `getNodeFeaturesInOverlays(nodeId)` returns `{id: overlayId, features[]}[]` — overlays that pin this node
- **No direct `overlay.mapId` field** — overlays don't store their parent map ID

### ✅ CONFIRMED: Reverse index approach for pins
- During section tree processing of `maps` nodes: record `map.overlayIds[]`
- Build reverse map: `overlayId → mapArtId`
- When processing card pins via `getNodeFeaturesInOverlays`, look up overlay → map

### ✅ CONFIRMED: `collab.maps` exposes:
- `getOverlays(mapId)` → `MapOverlay[]` (reads `map.overlayIds`)
- `listenToMap`, `listenToFeatures`, `getAvailable`, `search`, `getUnits`, `getProperty`
- Base methods add: `get(mapId)` → `Map` object with `overlayIds`

---

## Sections (OT type 'sections')

### ✅ CONFIRMED: Sections are document structure containers
- Appear in section tree as `type: 'sections'`
- Exported as display type `'list'` in exporter
- `collab.sections` exposes: `getChildArtifacts`, `getChildCount`, `getLockedSections`, `getSectionLineage`, `getCountOfChildrenSyncedOutside`
- `getCountOfChildrenSyncedOutside` — sections track how many children are cross-plan synced

---

## Orders (OT type 'orders')

### ✅ CONFIRMED: Orders are rich outline documents
- Exported as display type `'document'` in exporter (same as `documents`)
- Can contain embedded content: timelines, C2 charts, paragraphs, images, title entries
- `parseOutlineEntryData` parses the structured content
- Orders ARE different from `documents` (different renderer but both are document artifacts)

### ✅ CONFIRMED: Orders → list connection pattern (FIXED)
```typescript
// WRONG (silently fails — no PM content on the order object itself):
const listTableData = await (collab.orders as any).getListTablePmNodesData(orderId);

// CORRECT — orders have a docId pointer to a separate documents OT object:
const order = await (collab as any).orders?.get(orderId);
const docId = (order as any)?.docId;
if (!docId) continue;
const listTableData = await (collab.documents as any).getListTablePmNodesData(docId);
await emitListTableLinks(artId, listTableData);
```
- `order.docId` → the `documents` OT record that holds the PM snapshot
- `documentIndexer.ts` confirms: `orderIndexer` emits `order.docId → ['documents', docId]`
- Then `documentIndexer` walks the PM snapshot for embedded artifacts (list_table → listId, etc.)

---

## `collab.lists` Full API

```typescript
collab.lists.listNodes(listId)        // full NodeSavedType[] (flat, includes sub-cards)
collab.lists.getNodeIds(listId)       // number[] flat (via flattenTree)
collab.lists.getMany(listIds)         // List[] objects
collab.lists.getManyListNodes(listIds) // all nodes across multiple lists
collab.lists.serializeList(listId)    // plain text of the list
collab.lists.searchLists(query)       // search
collab.lists.getParentBoardTitles(listId) // board titles containing this list
```

### ✅ CONFIRMED: `collab.lists.getNodeIds` flattens sub-card tree
- `list.nodeIds` internal shape: `Array<{nodeId: number, children: SameType[]}>`
- `flattenTree` walks all levels → ALL nodes returned including nested sub-cards

---

## `collab.briefs` Full API

```typescript
collab.briefs.getNestedStructure()           // SectionTree[] (no briefId)
collab.briefs.getNestedStructureWithBrief()  // SectionTreeWithBriefId[] (each node has briefId!)
collab.briefs.getCurrentBrief()             // current Brief object
collab.briefs.getCurrentBriefId()           // current brief ID number
collab.briefs.getUnlinkedArtifacts()        // artifacts not in structure
```

### ✅ CONFIRMED: Use `getNestedStructureWithBrief()` for cross-plan detection on tree nodes
- Returns each tree node with `briefId: tx.get(tree.type, tree.id)?.briefId`
- Avoids needing to call `getTitleAndType` or separate `briefId` lookups

---

## Architecture Decisions

- **Ghost nodes**: artifact that appears in multiple plan exports gets ghost copies in non-native plans
- **Native plan detection**: `sourceBriefId` field on exported artifact (from `record.briefId`)
- **No syncs links**: removed — `getUsedInArtifacts` was same-plan consumers, not cross-plan
- **`contains` link**: hierarchical ownership (plan→board, board→list, list→card)
- **`primaryParent` map**: once set for an artifact ID, blocks further `contains` assignments (later phases emit `pins` instead). **Critical rule**: only Phase 5 (`processBoard`) and Phase 5.9 fallback may set `primaryParent` for lists/cards — all earlier phases must use `emitArtifact` + `pins` only. Phase 5.9 assigns `plan → artifact` for any artifact still without a parent after all phases.
- **`pins` link**: map pins a card at a location; whiteboard/presentation widget references a list/board
- **`sourced_from` link**: card references a file_document (source doc)
- **`contributes`/`blocks`**: C&E causal relationships between cards (NOT emitted — removed from scope)
- **`ghost` link** (viewer-internal): connects original artifact to its ghost copy in destination plan
- **Visual IDs** (viewer-internal): `canonicalId + '⊕' + parentId` for duplicated card nodes
- **`syncedToOtherPlans`** on `ArtifactRecord`: true when this plan's card is also live in other plans (outgoing sync); shown as `↗S` badge
