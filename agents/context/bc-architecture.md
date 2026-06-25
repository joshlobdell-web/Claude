# bc Architecture — Quick Reference

Onebrief's monorepo at `/root/repos/bc`. Key packages for feature work:

## Package Map

| Package | Path | What it is |
|---|---|---|
| `bc-app` | `packages/bc-app/` | React/Vite frontend |
| `bc-collab` | `packages/bc-collab/` | OT real-time layer (`collab.*` namespace) |
| `bc-artifacts-client` | `packages/bc-artifacts-client/` | REST API client |
| `bc-artifact-classification` | `packages/bc-artifact-classification/` | Type utilities |

## bc-app Import Aliases

```typescript
import { ... } from 'utils/ArtifactMap'        // packages/bc-app/src/utils/ArtifactMap/
import { retrieveBriefs } from 'api-client/briefs'  // packages/bc-artifacts-client/src/api-client/briefs.ts
import { collab } from 'bc-collab'
```

## collab Namespace

The `collab` object is the primary interface to the OT store. All calls go through it:

```typescript
import { collab } from 'bc-collab';
```

### Confirmed APIs by category

**Briefs / structure:**
```typescript
collab.briefs.getNestedStructure()            // SectionTree[] (no briefId on nodes)
collab.briefs.getNestedStructureWithBrief()   // SectionTreeWithBriefId[] (nodes have briefId = tx.briefId)
collab.briefs.getCurrentBrief()               // current Brief object
collab.briefs.getCurrentBriefId()             // current brief ID number
(collab.briefs as any).get(briefId)           // async getter — any brief
```

> ⚠️ `getNestedStructureWithBrief()` is bound to `tx.briefId` — always returns the CURRENT plan's structure regardless of argument. For other plans, use `(collab.briefs as any).get(briefId)` + `(collab as any).sections?.get(sectionId)` to build the tree.

**Boards:**
```typescript
collab.boards.getTitleAndType(boardId)        // { title, boardType }
collab.boards.getLists(boardId)               // List[] with id, title, briefId, createdAt
collab.boards.getNodes(boardId)               // Node[] — for map/c2 boards (nodeIds, not lists)
(collab.boards as any).get(boardId)           // raw board object with briefId
```

**Lists (OT type 'sections'):**
```typescript
collab.lists.getMany(listIds)                 // List[] objects
collab.lists.getNodeIds(listId)               // flat number[] (flattenTree — includes sub-cards)
collab.lists.listNodes(listId)                // full NodeSavedType[]
collab.lists.getParentBoardTitles(listId)     // board titles
(collab.lists as any).getList?.(listId)       // async load — may not exist, optional chain
```

**Nodes (cards):**
```typescript
collab.nodes.getMany(ids)                     // NodeSavedType[] — no textDoc
collab.nodes.getListIds(nodeId)               // ALL list IDs across ALL plans containing this node
collab.nodes.getEdges(nodeId)                 // edges connected to this node
```

**Documents:**
```typescript
collab.documents.getNodeDocument(nodeId)      // Document | undefined
collab.documents.getNodeText(textDocId)       // string | undefined — calls textContent(doc.snapshot)
(collab.documents as any).get(docId)          // Document record; PM content at record.snapshot
(collab.documents as any).getListTablePmNodesData(docId)   // {[key]: {listId}} PM list-table nodes
(collab.documents as any).getNodeEmbedPmNodesData?.(docId) // node embed PM nodes
```

**C2 units:**
```typescript
collab.c2_units.getBoardUnits(boardId)        // c2_unit[]
collab.c2_units.getUnitNode(unitId)           // underlying node
collab.c2_units.getTextContent(unitId)        // { textDoc: Document|null, statement: string|undefined }
```

**Edges:**
```typescript
collab.edges.getAll()                         // Record<number, Edge> — all edges for current brief
// Edge: { sourceNodeId, targetNodeId, affirmative, probGivenSource, probGivenNotSource }
```

**Global title lookup:**
```typescript
collab.global.getTitle(otType, id)            // Works for: boards, maps, whiteboards, presentations, file_documents, documents, orders
                                               // Does NOT work for: nodes (use statement/textDoc), c2_units
```

**Other:**
```typescript
collab.sections                               // raw OT sections namespace — (collab as any).sections?.get(id)
(collab as any).orders?.get(orderId)          // { docId, title, ... }
(collab as any).whiteboards?.get(wbId)        // whiteboard with widgets[]
(collab as any).maps?.get(mapId)              // map with overlayIds[]
(collab as any).map_overlays?.get(overlayId)  // overlay with features[]
(collab as any).presentations?.get(presId)    // presentation
(collab as any).presentations?.getSlides(presId)  // PresentationSlide[]
```

## OT Type → Display Type Mapping

| OT type | Display type | How to get content |
|---|---|---|
| `boards` (boardType='') | `board` | `getLists` → `getNodeIds` |
| `boards` (boardType='c2') | `c2board` | `getBoardUnits` |
| `boards` (boardType='timeline') | `timeline` | `getLists` → `getNodeIds` |
| `boards` (boardType='map', no edges) | `map` | `getNodes` |
| `boards` (boardType='map', has edges) | `cause_effect` | `getNodes` |
| `sections` | `list` | `getMany` for title; `getNodeIds` for cards |
| `nodes` | `card` | `getMany`; label from statement or textDocId |
| `maps` | `map` | `get` → `overlayIds` |
| `whiteboards` | `whiteboard` | `get` → `widgets[]` |
| `presentations` | `presentation` | `getSlides` → per-slide `widgets[]` |
| `documents` | `document` | `get` → `snapshot` (PM tree) |
| `orders` | `document` | `get` → `docId` → load document snapshot |
| `file_documents` | `reference` | `getTitle` |

## Cross-Plan Detection

The only reliable signal: `record.briefId !== currentPlanId`

- Available on: nodes, lists, boards, sections
- `collab.nodes.getListIds(nodeId)` returns lists across ALL plans — use `list.briefId` to find other-plan lists

## Card Label Resolution (confirmed order)

1. `node.statement` — if non-null and doesn't start with `{`
2. `await collab.documents.getNodeText(node.textDocId)` — plain text from rich-text doc
3. Fallback: `Card ${node.id}`

> `collab.global.getTitle('nodes', id)` always returns `''` — nodes have `statement`, not `title`. Do not use.

## bc Deployment

Claude Code sandbox cannot write to `/root/repos/bc/`. User must run cp commands manually. Files live in `features/` in this repo; bc destination is `packages/bc-app/src/utils/`.
