import { collab } from 'bc-collab';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OTType =
  | 'boards'
  | 'maps'
  | 'whiteboards'
  | 'presentations'
  | 'presentation_slides'
  | 'file_documents'
  | 'documents'
  | 'orders'
  | 'sections'
  | 'nodes'
  | 'c2_units';

type DisplayType =
  | 'plan'
  | 'board'
  | 'c2board'
  | 'timeline'
  | 'whiteboard'
  | 'cause_effect'
  | 'map'
  | 'presentation'
  | 'document'
  | 'reference'
  | 'list'
  | 'card';

type LinkType = 'contains' | 'pins' | 'sourced_from';

interface Artifact {
  id: string;
  type: DisplayType;
  label: string;
  plan: string;
  sourceBriefId?: number;
  createdAt?: string;
  boardType?: string;
}

interface Link {
  type: LinkType;
  src: string;
  tgt: string;
}

interface ExportOutput {
  exportedAt: string;
  plan: { id: number; title: string };
  artifacts: Artifact[];
  links: Link[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function boardTypeToDisplayType(boardType: string): DisplayType {
  switch (boardType) {
    case 'c2':       return 'c2board';
    case 'timeline': return 'timeline';
    case 'map':      return 'map';
    default:         return 'board';
  }
}

function sectionOTTypeToDisplayType(otType: string): DisplayType | null {
  switch (otType) {
    case 'maps':           return 'map';
    case 'whiteboards':    return 'whiteboard';
    case 'presentations':  return 'presentation';
    case 'file_documents': return 'reference';
    case 'documents':      return 'document';
    case 'orders':         return 'document';
    case 'sections':       return 'list';
    default:               return null;
  }
}

function makeId(otType: string, numericId: number): string {
  return `${otType}_${numericId}`;
}

function planId(briefId: number): string {
  return `plan_${briefId}`;
}

// ---------------------------------------------------------------------------
// Label resolution
// ---------------------------------------------------------------------------

async function resolveNodeLabel(node: {
  id: number;
  statement?: string | null;
  textDocId?: number | null;
}): Promise<string> {
  const stmt = node.statement?.trim();
  if (stmt && !stmt.startsWith('{')) return stmt;
  if (node.textDocId) {
    try {
      const text = await collab.documents.getNodeText(node.textDocId);
      if (text?.trim()) return text.trim();
    } catch { /* ignore */ }
  }
  return `Card ${node.id}`;
}

async function resolveC2UnitLabel(unitId: number): Promise<string> {
  try {
    const unitNode = await collab.c2_units.getUnitNode(unitId);
    if (unitNode) {
      const stmt = unitNode.statement?.trim();
      if (stmt && !stmt.startsWith('{')) return stmt;
      if ((unitNode as any).textDocId) {
        const text = await collab.documents.getNodeText((unitNode as any).textDocId);
        if (text?.trim()) return text.trim();
      }
    }
  } catch { /* ignore */ }
  return `Unit ${unitId}`;
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

export async function exportArtifactMap(briefId: number, briefTitle: string): Promise<void> {
  const topLevel = await collab.briefs.getNestedStructureWithBrief();
  if (!topLevel.length) {
    console.warn('[exportArtifactMap] No plan structure found.');
    return;
  }

  const planArtId = planId(briefId);

  // ── Emission helpers ──────────────────────────────────────────────────────

  const artifacts: Artifact[] = [];
  const links: Link[] = [];
  const emittedArtifacts = new Set<string>();
  const emittedLinks = new Set<string>();
  const primaryParent = new Map<string, string>();

  function emitArtifact(a: Artifact): void {
    if (!emittedArtifacts.has(a.id)) {
      emittedArtifacts.add(a.id);
      artifacts.push(a);
    }
  }

  function emitLink(lk: Link): void {
    const key = `${lk.type}:${lk.src}:${lk.tgt}`;
    if (!emittedLinks.has(key)) {
      emittedLinks.add(key);
      links.push(lk);
    }
  }

  emitArtifact({ id: planArtId, type: 'plan', label: briefTitle, plan: planArtId });

  // artifacts from section tree that need widget processing
  const discoveredWhiteboards  = new Map<number, string>(); // numericId → artId
  const discoveredPresentations = new Map<number, string>();
  const discoveredDocuments     = new Map<number, string>();
  const discoveredOrders        = new Map<number, string>();
  const discoveredMaps = new Map<number, string>(); // numericId → artId

  // ── Phase 1: Section tree ─────────────────────────────────────────────────

  async function processSectionTree(tree: any[], parentArtId: string): Promise<void> {
    for (const node of tree) {
      if (node.type === 'boards') {
        await processSectionTree(node.children, parentArtId);
        continue;
      }

      const displayType = sectionOTTypeToDisplayType(node.type);
      if (!displayType) {
        await processSectionTree(node.children, parentArtId);
        continue;
      }

      const artId = makeId(node.type, node.id);
      let label = 'Untitled';
      try {
        if (node.type === 'sections') {
          // getTitle is synchronous and returns '' for uncached lists → use async getMany
          const ls = await collab.lists.getMany([node.id]);
          label = (ls as any)?.[0]?.title || label;
        } else {
          label = (await collab.global.getTitle(node.type as OTType, node.id)) || label;
        }
      } catch { /* ignore */ }

      emitArtifact({
        id: artId, type: displayType, label, plan: planArtId,
        sourceBriefId: node.briefId ?? undefined,
      });

      if (!primaryParent.has(artId)) {
        primaryParent.set(artId, parentArtId);
        emitLink({ type: 'contains', src: parentArtId, tgt: artId });
      }

      if (node.type === 'maps')          discoveredMaps.set(node.id, artId);
      if (node.type === 'whiteboards')   discoveredWhiteboards.set(node.id, artId);
      if (node.type === 'presentations') discoveredPresentations.set(node.id, artId);
      if (node.type === 'documents') discoveredDocuments.set(node.id, artId);
      if (node.type === 'orders')    discoveredOrders.set(node.id, artId);

      await processSectionTree(node.children, artId);
    }
  }

  await processSectionTree(topLevel, planArtId);

  // ── Phase 2: Collect board IDs ────────────────────────────────────────────

  const boardIds = new Set<number>();
  function collectBoardIds(tree: any[]): void {
    for (const node of tree) {
      if (node.type === 'boards') boardIds.add(node.id);
      collectBoardIds(node.children ?? []);
    }
  }
  collectBoardIds(topLevel);

  const boardDisplayTypes = new Map<number, DisplayType>();
  const boardRawTypes     = new Map<number, string>();
  const boardDescendantNodes = new Map<number, Set<number>>();
  const boardInfoCache = new Map<number, { title: string; boardType?: string; briefId?: number }>();

  async function fetchBoardInfo(boardId: number): Promise<void> {
    if (boardInfoCache.has(boardId)) return;
    try {
      const info = await collab.boards.getTitleAndType(boardId);
      if (!info) return;
      // getTitleAndType returns { title, boardType } but NOT briefId.
      // Fetch the full board object to get briefId for cross-plan detection.
      let briefId: number | undefined;
      try {
        const board = await (collab.boards as any).get(boardId);
        briefId = (board as any)?.briefId ?? undefined;
      } catch { /* ignore */ }
      boardInfoCache.set(boardId, { ...(info as any), briefId });
    } catch { /* ignore */ }
  }

  for (const boardId of boardIds) await fetchBoardInfo(boardId);

  // ── Phase 3: Widget-embedded content ──────────────────────────────────────
  //
  // Rule: if the embedded artifact already exists in the section tree (standalone),
  // emit `pins` from the container. Otherwise emit `contains` from the PLAN (not from
  // the whiteboard/presentation — that would break the tier-based layout since both
  // the container and the embedded artifact would be at tier 3) plus `pins` from the
  // container to show the embedding relationship.

  async function processWidgets(widgets: any[], containerArtId: string): Promise<void> {
    for (const widget of widgets) {
      // Build a strongly-typed local scope to avoid null/undefined confusion
      let embeddedId = 0;
      let embeddedOT: OTType | '' = '';
      let embeddedType: DisplayType | null = null;

      const cfg = (widget.config ?? {}) as any;

      // list-table widgets reference a sections list directly via config.listId.
      // Handle separately — lists don't recurse further and aren't OT artifact containers.
      if ((widget.type as string) === 'list-table') {
        const listId = cfg.listId as number | undefined;
        if (listId) {
          const listArtId = makeId('sections', listId);
          if (!emittedArtifacts.has(listArtId)) {
            let label = `List ${listId}`;
            try { const ls = await collab.lists.getMany([listId]); label = (ls as any)?.[0]?.title || label; } catch { /* ignore */ }
            emitArtifact({ id: listArtId, type: 'list', label, plan: planArtId });
            if (!primaryParent.has(listArtId)) {
              primaryParent.set(listArtId, planArtId);
              emitLink({ type: 'contains', src: planArtId, tgt: listArtId });
            }
          }
          emitLink({ type: 'pins', src: containerArtId, tgt: listArtId });
        }
        continue;
      }

      switch (widget.type as string) {
        case 'map':
          if (cfg.mapId) { embeddedId = cfg.mapId; embeddedOT = 'maps'; embeddedType = 'map'; }
          break;
        case 'c2':
        case 'comrel':
          if (cfg.boardId) { embeddedId = cfg.boardId; embeddedOT = 'boards'; embeddedType = 'c2board'; }
          break;
        case 'timeline':
          if (cfg.boardId) { embeddedId = cfg.boardId; embeddedOT = 'boards'; embeddedType = 'timeline'; }
          break;
        case 'whiteboard':
          if (cfg.whiteboardId) { embeddedId = cfg.whiteboardId; embeddedOT = 'whiteboards'; embeddedType = 'whiteboard'; }
          break;
      }

      if (!embeddedId || !embeddedOT || !embeddedType) continue;

      const embeddedArtId = makeId(embeddedOT, embeddedId);
      const alreadyEmitted = emittedArtifacts.has(embeddedArtId);

      if (!alreadyEmitted) {
        let label = 'Untitled';
        try {
          label = (await collab.global.getTitle(embeddedOT, embeddedId)) || label;
        } catch { /* ignore */ }
        emitArtifact({ id: embeddedArtId, type: embeddedType, label, plan: planArtId });
        // Place under plan so the tier-based layout can position it correctly.
        // The container → embedded relationship is shown via the pins link below.
        primaryParent.set(embeddedArtId, planArtId);
        emitLink({ type: 'contains', src: planArtId, tgt: embeddedArtId });
      }

      // Always emit a pins link to show the embedding relationship
      emitLink({ type: 'pins', src: containerArtId, tgt: embeddedArtId });

      // Embedded boards need to be fully processed in the board pass
      if (embeddedOT === 'boards' && !boardIds.has(embeddedId)) {
        boardIds.add(embeddedId);
        await fetchBoardInfo(embeddedId);
      }

      if (embeddedOT === 'maps') discoveredMaps.set(embeddedId, embeddedArtId);

      // Embedded whiteboards: recurse into their widgets
      if (embeddedOT === 'whiteboards' && !alreadyEmitted) {
        try {
          const wb = await (collab.whiteboards as any).get(embeddedId);
          if (wb?.widgets?.length) await processWidgets(wb.widgets, embeddedArtId);
        } catch { /* ignore */ }
      }
    }
  }

  // Whiteboards
  for (const [wbId, artId] of discoveredWhiteboards) {
    try {
      const wb = await (collab.whiteboards as any).get(wbId);
      if (wb?.widgets?.length) await processWidgets(wb.widgets, artId);
    } catch { /* ignore */ }
  }

  // Presentations: iterate slides, then slide widgets
  for (const [presId, artId] of discoveredPresentations) {
    try {
      let slides: any[] = [];
      try {
        slides = await (collab.presentations as any).getSlides(presId);
      } catch {
        const pres = await (collab.presentations as any).get(presId);
        for (const slideId of (pres as any)?.slideIds ?? []) {
          try {
            const slide = await (collab as any).presentation_slides?.get(slideId);
            if (slide) slides.push(slide);
          } catch { /* ignore */ }
        }
      }
      for (const slide of slides ?? []) {
        if (slide?.widgets?.length) await processWidgets(slide.widgets, artId);
      }
    } catch { /* ignore */ }
  }

  async function emitListTableLinks(artId: string, listTableData: any): Promise<void> {
    for (const entry of Object.values(listTableData as any)) {
      const listId = (entry as any)?.settings?.listId as number | undefined;
      if (!listId) continue;
      const listArtId = makeId('sections', listId);
      if (!emittedArtifacts.has(listArtId)) {
        let label = `List ${listId}`;
        try { const ls = await collab.lists.getMany([listId]); label = (ls as any)?.[0]?.title || label; } catch { /* ignore */ }
        emitArtifact({ id: listArtId, type: 'list', label, plan: planArtId });
        primaryParent.set(listArtId, planArtId);
        emitLink({ type: 'contains', src: planArtId, tgt: listArtId });
      }
      emitLink({ type: 'pins', src: artId, tgt: listArtId });
    }
  }

  // Documents: extract list references from ProseMirror list_table nodes
  for (const [docId, artId] of discoveredDocuments) {
    try {
      const listTableData = await (collab.documents as any).getListTablePmNodesData(docId);
      await emitListTableLinks(artId, listTableData);
    } catch { /* ignore */ }
  }

  // Orders: same structure but use the orders API (different OT type / backing store)
  // Orders don't have their own PM snapshot — they have a docId pointing to a Document OT object.
  // Get order.docId first, then walk that document for list_table nodes.
  for (const [orderId, artId] of discoveredOrders) {
    try {
      const order = await (collab as any).orders?.get(orderId);
      const docId = (order as any)?.docId;
      if (!docId) continue;
      const listTableData = await (collab.documents as any).getListTablePmNodesData(docId);
      await emitListTableLinks(artId, listTableData);
    } catch { /* ignore */ }
  }

  // ── Phase 4: Source document helper ──────────────────────────────────────

  async function emitSourceDocLink(cardArtId: string, fileDocId: number, nodeBriefId?: number): Promise<void> {
    // Cross-plan synced cards may reference docs that belong to their native plan.
    // Skip entirely — the native plan's export will include the reference correctly.
    if (nodeBriefId != null && nodeBriefId !== briefId) return;
    const fileDocArtId = makeId('file_documents', fileDocId);
    if (!emittedArtifacts.has(fileDocArtId)) {
      let label = 'Reference';
      try { label = (await collab.global.getTitle('file_documents', fileDocId)) || label; } catch { /* ignore */ }
      emitArtifact({ id: fileDocArtId, type: 'reference', label, plan: planArtId });
      if (!primaryParent.has(fileDocArtId)) {
        primaryParent.set(fileDocArtId, planArtId);
        emitLink({ type: 'contains', src: planArtId, tgt: fileDocArtId });
      }
    }
    emitLink({ type: 'sourced_from', src: fileDocArtId, tgt: cardArtId });
  }

  // ── Phase 5: Board processing ─────────────────────────────────────────────

  // Regular list boards first so cards establish primaryParent before
  // visual/analytical boards (C2, map, timeline) claim them via pins.
  const specialTypes = new Set(['c2', 'map', 'timeline']);
  const sortedBoardIds = [...boardIds].sort((a, b) => {
    const aS = specialTypes.has(boardInfoCache.get(a)?.boardType ?? '') ? 1 : 0;
    const bS = specialTypes.has(boardInfoCache.get(b)?.boardType ?? '') ? 1 : 0;
    return aS - bS;
  });

  async function processBoard(boardId: number): Promise<void> {
    const info = boardInfoCache.get(boardId) ?? await collab.boards.getTitleAndType(boardId);
    if (!info) return;

    const rawBoardType = info.boardType ?? '';
    const displayType  = boardTypeToDisplayType(rawBoardType);
    boardDisplayTypes.set(boardId, displayType);
    boardRawTypes.set(boardId, rawBoardType);

    const artId = makeId('boards', boardId);
    const label = info.title || `Board ${boardId}`;

    emitArtifact({
      id: artId, type: displayType, label, plan: planArtId,
      boardType: rawBoardType,
      sourceBriefId: (info as any).briefId ?? undefined,
    });

    if (!primaryParent.has(artId)) {
      primaryParent.set(artId, planArtId);
      emitLink({ type: 'contains', src: planArtId, tgt: artId });
    }

    const descendantNodes = new Set<number>();
    boardDescendantNodes.set(boardId, descendantNodes);

    if (displayType === 'c2board') {
      await processC2Board(boardId, artId, descendantNodes);
    } else if (rawBoardType === 'map') {
      await processDirectNodeBoard(boardId, artId, descendantNodes);
    } else if (rawBoardType === 'timeline') {
      // Timeline events are stored in lists (with at/duration fields), not board.nodeIds
      await processListBoard(boardId, artId, descendantNodes);
    } else {
      await processListBoard(boardId, artId, descendantNodes);
    }
  }

  async function processC2Board(
    boardId: number, boardArtId: string, descendantNodes: Set<number>
  ): Promise<void> {
    try {
      const units = await collab.c2_units.getBoardUnits(boardId);
      for (const unit of units) {
        const cardArtId = unit.nodeId != null
          ? makeId('nodes', unit.nodeId)
          : makeId('c2_units', unit.id);

        const unitLabel = await resolveC2UnitLabel(unit.id);
        emitArtifact({
          id: cardArtId, type: 'card', label: unitLabel, plan: planArtId,
          sourceBriefId: (unit as any).briefId ?? undefined,
        });

        if (primaryParent.has(cardArtId)) {
          emitLink({ type: 'pins', src: boardArtId, tgt: cardArtId });
        } else {
          primaryParent.set(cardArtId, boardArtId);
          emitLink({ type: 'contains', src: boardArtId, tgt: cardArtId });
        }

        if (unit.nodeId != null) {
          descendantNodes.add(unit.nodeId);
          try {
            const unitNode = await collab.c2_units.getUnitNode(unit.id);
            const fileDocId = (unitNode as any)?.fileDocumentId as number | null | undefined;
            if (fileDocId) await emitSourceDocLink(cardArtId, fileDocId, (unit as any).briefId as number | undefined);
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  async function processDirectNodeBoard(
    boardId: number, boardArtId: string, descendantNodes: Set<number>
  ): Promise<void> {
    try {
      const boardNodes = await collab.boards.getNodes(boardId);
      for (const node of boardNodes) {
        if (!node) continue;
        const cardArtId = makeId('nodes', node.id);
        const cardLabel = await resolveNodeLabel(node as any);

        emitArtifact({
          id: cardArtId, type: 'card', label: cardLabel, plan: planArtId,
          sourceBriefId: (node as any).briefId ?? undefined,
          createdAt: node.createdAt ? new Date(node.createdAt).toISOString() : undefined,
        });

        if (primaryParent.has(cardArtId)) {
          emitLink({ type: 'pins', src: boardArtId, tgt: cardArtId });
        } else {
          primaryParent.set(cardArtId, boardArtId);
          emitLink({ type: 'contains', src: boardArtId, tgt: cardArtId });
        }

        descendantNodes.add(node.id);

        const fileDocId = (node as any).fileDocumentId as number | null | undefined;
        if (fileDocId) await emitSourceDocLink(cardArtId, fileDocId, (node as any).briefId as number | undefined);
      }
    } catch { /* ignore */ }
  }

  async function processListBoard(
    boardId: number, boardArtId: string, descendantNodes: Set<number>
  ): Promise<void> {
    try {
      const lists = await collab.boards.getLists(boardId);
      for (const list of lists) {
        const listArtId = makeId('sections', list.id);

        let listLabel = list.title || '';
        if (!listLabel) {
          try {
            const fetched = await collab.lists.getMany([list.id]);
            listLabel = (fetched as any)?.[0]?.title || '';
          } catch { /* ignore */ }
        }
        emitArtifact({
          id: listArtId, type: 'list',
          label: listLabel || `List ${list.id}`,
          plan: planArtId,
          sourceBriefId: (list as any).briefId ?? undefined,
          createdAt: list.createdAt ? new Date(list.createdAt).toISOString() : undefined,
        });

        if (!primaryParent.has(listArtId)) {
          primaryParent.set(listArtId, boardArtId);
          emitLink({ type: 'contains', src: boardArtId, tgt: listArtId });
        } else {
          // List is shared across multiple boards (e.g. timeline lanes = cards board lists).
          // Show the relationship without changing ownership.
          emitLink({ type: 'pins', src: boardArtId, tgt: listArtId });
        }

        try {
          const nodeIds = await collab.lists.getNodeIds(list.id);
          if (nodeIds.length > 0) {
            const nodes = await collab.nodes.getMany(nodeIds);
            for (const node of nodes) {
              const cardArtId = makeId('nodes', node.id);
              const cardLabel = await resolveNodeLabel(node as any);

              emitArtifact({
                id: cardArtId, type: 'card', label: cardLabel, plan: planArtId,
                sourceBriefId: (node as any).briefId ?? undefined,
                createdAt: node.createdAt ? new Date(node.createdAt).toISOString() : undefined,
              });

              emitLink({ type: 'contains', src: listArtId, tgt: cardArtId });

              if (!primaryParent.has(cardArtId)) {
                primaryParent.set(cardArtId, listArtId);
                descendantNodes.add(node.id);
              }

              const fileDocId = (node as any).fileDocumentId as number | null | undefined;
              if (fileDocId) await emitSourceDocLink(cardArtId, fileDocId, (node as any).briefId as number | undefined);
            }
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  for (const boardId of sortedBoardIds) {
    await processBoard(boardId);
  }

  // ── Phase 5.5: Map overlay → card pins ───────────────────────────────────
  // Load each map explicitly (map_overlays may not be pre-cached in the sync
  // store), then walk overlay features for card pin references.
  for (const [mapNumericId, mapArtId] of discoveredMaps) {
    try {
      const map = await (collab.maps as any).get(mapNumericId);
      for (const overlayId of (map as any)?.overlayIds ?? []) {
        try {
          const overlay = await (collab as any).map_overlays?.get(overlayId);
          for (const feature of (overlay as any)?.features ?? []) {
            const props = (feature as any).properties;
            // Overlay features can pin nodes (cards) or lists — mirror mapOverlayIndexer
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
                try { const ls = await collab.lists.getMany([listNumId]); label = (ls as any)?.[0]?.title || label; } catch { /* ignore */ }
                emitArtifact({ id: listArtId, type: 'list', label, plan: planArtId });
                if (!primaryParent.has(listArtId)) {
                  primaryParent.set(listArtId, planArtId);
                  emitLink({ type: 'contains', src: planArtId, tgt: listArtId });
                }
              }
              emitLink({ type: 'pins', src: mapArtId, tgt: listArtId });
            }
          }
        } catch { /* ignore individual overlay errors */ }
      }
    } catch { /* ignore */ }
  }

  // ── Phase 6: C&E upgrade detection ───────────────────────────────────────

  try {
    const allEdges = await collab.edges.getAll();
    const nodeToBoardIds = new Map<number, Set<number>>();
    for (const [boardId, nodeSet] of boardDescendantNodes) {
      for (const nodeId of nodeSet) {
        if (!nodeToBoardIds.has(nodeId)) nodeToBoardIds.set(nodeId, new Set());
        nodeToBoardIds.get(nodeId)!.add(boardId);
      }
    }
    const boardsWithEdges = new Set<number>();
    for (const edge of Object.values(allEdges)) {
      const srcBoards = nodeToBoardIds.get(edge.sourceNodeId);
      const tgtBoards = nodeToBoardIds.get(edge.targetNodeId);
      if (srcBoards && tgtBoards) {
        for (const bid of srcBoards) {
          if (tgtBoards.has(bid) && boardRawTypes.get(bid) === 'map') boardsWithEdges.add(bid);
        }
      }
    }
    for (const bid of boardsWithEdges) {
      boardDisplayTypes.set(bid, 'cause_effect');
      const existing = artifacts.find(a => a.id === makeId('boards', bid));
      if (existing) existing.type = 'cause_effect';
    }
  } catch { /* edges may not be available in all contexts */ }

  // ── Phase 7: Download ─────────────────────────────────────────────────────

  const output: ExportOutput = {
    exportedAt: new Date().toISOString(),
    plan: { id: briefId, title: briefTitle },
    artifacts,
    links,
  };

  const json = JSON.stringify(output, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `artifact-map-${briefTitle.replace(/\s+/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log(`[exportArtifactMap] Done. ${artifacts.length} artifacts, ${links.length} links.`);
}
