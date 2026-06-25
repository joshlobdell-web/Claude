/**
 * getArtifactMapData.ts
 *
 * Same pipeline as exportArtifactMap.ts but returns the data in-memory
 * instead of triggering a download. Also adds outgoing cross-plan sync
 * detection (syncedToOtherPlans / syncedPlanBriefIds on card artifacts).
 *
 * Place at: packages/bc-app/src/utils/getArtifactMapData.ts
 */

import { collab } from 'bc-collab';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OTType =
  | 'boards' | 'maps' | 'whiteboards' | 'presentations' | 'presentation_slides'
  | 'file_documents' | 'documents' | 'orders' | 'sections' | 'nodes' | 'c2_units';

export type DisplayType =
  | 'plan' | 'board' | 'c2board' | 'timeline' | 'whiteboard' | 'cause_effect'
  | 'map' | 'presentation' | 'document' | 'reference' | 'list' | 'card' | 'section';

export type LinkType = 'contains' | 'pins' | 'sourced_from';

export interface ArtifactRecord {
  id: string;
  type: DisplayType;
  label: string;
  plan: string;
  sourceBriefId?: number;
  createdAt?: string;
  boardType?: string;
  /** True when this card is synced INTO other plans (outgoing). */
  syncedToOtherPlans?: boolean;
  /** Numeric brief IDs of plans this card has been synced into. */
  syncedPlanBriefIds?: number[];
}

export interface LinkRecord {
  type: LinkType;
  src: string;
  tgt: string;
}

export interface ArtifactMapData {
  exportedAt: string;
  plan: { id: number; title: string };
  artifacts: ArtifactRecord[];
  links: LinkRecord[];
}

// ---------------------------------------------------------------------------
// Helpers (identical to exportArtifactMap.ts)
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
    case 'sections':       return 'section';
    default:               return null;
  }
}

function makeId(otType: string, numericId: number): string {
  return `${otType}_${numericId}`;
}

function planArtId(briefId: number): string {
  return `plan_${briefId}`;
}

// ---------------------------------------------------------------------------
// Label resolution
// ---------------------------------------------------------------------------

async function resolveNodeLabel(node: {
  id: number; statement?: string | null; textDocId?: number | null;
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
// Multi-plan structure loader
// ---------------------------------------------------------------------------

// Builds a section-tree for any briefId by walking the OT store asynchronously.
// Used when briefId differs from the current transaction's plan, because
// getNestedStructureWithBrief() is bound to tx.briefId and always returns the
// currently-open plan's structure regardless of the argument.
async function loadStructureForBrief(targetBriefId: number): Promise<any[]> {
  const brief: any = await (collab.briefs as any).get(targetBriefId);
  const rawStructure: any[] = brief?.structure ?? [];
  if (!rawStructure.length) return [];

  async function buildNodes(items: { type: string; id: number }[]): Promise<any[]> {
    const nodes: any[] = [];
    for (const item of items) {
      const node: any = { type: item.type, id: item.id, briefId: targetBriefId, children: [] };
      if (item.type === 'sections') {
        try {
          // getList uses tx.load (async server fetch) — works for sections in any plan.
          // sections.get uses tx.get (sync cache-only) and returns null for non-current plans,
          // which would leave all nested boards undiscovered and break the ghost mechanism.
          let sec: any = await (collab.lists as any).getList?.(item.id);
          if (!sec?.structure?.length) {
            sec = await (collab as any).sections?.get(item.id);
          }
          if (sec?.structure?.length) node.children = await buildNodes(sec.structure);
        } catch { /* ignore */ }
      }
      nodes.push(node);
    }
    return nodes;
  }
  return buildNodes(rawStructure);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function getArtifactMapData(
  briefId: number,
  briefTitle: string,
): Promise<ArtifactMapData> {
  // getNestedStructureWithBrief() uses tx.briefId internally — it always returns the
  // currently-open plan's structure. Detect the mismatch by checking the returned briefId,
  // and fall back to the async OT getter path for any other plan.
  const nativeTopLevel = await collab.briefs.getNestedStructureWithBrief();
  const nativeBriefId = (nativeTopLevel[0] as any)?.briefId as number | undefined;
  const topLevel = (nativeBriefId === briefId || nativeBriefId == null)
    ? nativeTopLevel
    : await loadStructureForBrief(briefId);
  if (!topLevel.length) throw new Error('[getArtifactMapData] No plan structure found.');

  const planId = planArtId(briefId);

  // ── Emission helpers ────────────────────────────────────────────────────

  const artifacts: ArtifactRecord[] = [];
  const links: LinkRecord[]   = [];
  const emittedArtifacts      = new Set<string>();
  const emittedLinks          = new Set<string>();
  const primaryParent         = new Map<string, string>();

  function isFallbackLabel(label: string): boolean {
    return /^(List|Card|Unit|Board|Reference)\s+\d+$/.test(label) || label === 'Untitled';
  }

  function emitArtifact(a: ArtifactRecord): void {
    if (!emittedArtifacts.has(a.id)) {
      emittedArtifacts.add(a.id);
      artifacts.push(a);
    } else if (!isFallbackLabel(a.label)) {
      // Upgrade a fallback label (e.g. "List 12345") with the real title when found later
      const existing = artifacts.find(x => x.id === a.id);
      if (existing && isFallbackLabel(existing.label)) existing.label = a.label;
    }
  }

  function emitLink(lk: LinkRecord): void {
    const key = `${lk.type}:${lk.src}:${lk.tgt}`;
    if (!emittedLinks.has(key)) {
      emittedLinks.add(key);
      links.push(lk);
    }
  }

  emitArtifact({ id: planId, type: 'plan', label: briefTitle, plan: planId });

  const discoveredWhiteboards   = new Map<number, string>();
  const discoveredPresentations = new Map<number, string>();
  const discoveredDocuments     = new Map<number, string>();
  const discoveredOrders        = new Map<number, string>();
  const discoveredMaps          = new Map<number, string>();

  // ── Phase 1: Section tree ──────────────────────────────────────────────

  // Maps numeric board ID → the section artId that contains it (if any).
  // Used in Phase 5 to emit a pins link from the section to its child boards.
  const boardsInSections = new Map<number, string>();

  async function processSectionTree(tree: any[], parentArtId: string): Promise<void> {
    for (const node of tree) {
      if (node.type === 'boards') {
        // If this board's immediate parent in the section tree is a section (not the plan root),
        // record the relationship so we can emit a pins link in Phase 5.
        if (parentArtId !== planId) boardsInSections.set(node.id, parentArtId);
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
          // collab.lists.getMany uses tx.get() (sync, cache-only).
          // Use collab.lists.getList() if available (uses tx.load — async server fetch),
          // then fall back to getMany, then fall back to global title lookup.
          try {
            const loaded = await (collab.lists as any).getList?.(node.id);
            label = (loaded as any)?.title || label;
          } catch { /* ignore */ }
          if (label === 'Untitled') {
            const ls = await collab.lists.getMany([node.id]);
            label = (ls as any)?.[0]?.title || label;
          }
          if (label === 'Untitled') {
            label = (await collab.global.getTitle('sections', node.id)) || label;
          }
        } else {
          label = (await collab.global.getTitle(node.type as OTType, node.id)) || label;
        }
      } catch { /* ignore */ }

      emitArtifact({ id: artId, type: displayType, label, plan: planId, sourceBriefId: node.briefId ?? undefined });

      if (!primaryParent.has(artId)) {
        primaryParent.set(artId, parentArtId);
        emitLink({ type: 'contains', src: parentArtId, tgt: artId });
      }

      if (node.type === 'maps')          discoveredMaps.set(node.id, artId);
      if (node.type === 'whiteboards')   discoveredWhiteboards.set(node.id, artId);
      if (node.type === 'presentations') discoveredPresentations.set(node.id, artId);
      if (node.type === 'documents')     discoveredDocuments.set(node.id, artId);
      if (node.type === 'orders')        discoveredOrders.set(node.id, artId);

      await processSectionTree(node.children, artId);
    }
  }

  await processSectionTree(topLevel, planId);

  // ── Phase 2: Board IDs ─────────────────────────────────────────────────

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
  const boardInfoCache    = new Map<number, { title: string; boardType?: string; briefId?: number }>();

  async function fetchBoardInfo(boardId: number): Promise<void> {
    if (boardInfoCache.has(boardId)) return;
    try {
      const info = await collab.boards.getTitleAndType(boardId);
      if (!info) return;
      let bfId: number | undefined;
      try { const b = await (collab.boards as any).get(boardId); bfId = (b as any)?.briefId; } catch { /* ignore */ }
      boardInfoCache.set(boardId, { ...(info as any), briefId: bfId });
    } catch { /* ignore */ }
  }

  await Promise.all([...boardIds].map(id => fetchBoardInfo(id)));

  // ── Phase 3: Widgets ───────────────────────────────────────────────────

  async function processWidgets(widgets: any[], containerArtId: string): Promise<void> {
    for (const widget of widgets) {
      let embeddedId = 0, embeddedOT: OTType | '' = '', embeddedType: DisplayType | null = null;
      const cfg = (widget.config ?? {}) as any;

      if ((widget.type as string) === 'list-table') {
        const listId = (cfg.listId ?? cfg.sectionId) as number | undefined;
        if (listId) {
          const listArtId = makeId('sections', listId);
          if (!emittedArtifacts.has(listArtId)) {
            let lbl = `List ${listId}`;
            try { const ls = await collab.lists.getMany([listId]); lbl = (ls as any)?.[0]?.title || lbl; } catch { /* ignore */ }
            emitArtifact({ id: listArtId, type: 'list', label: lbl, plan: planId });
          }
          emitLink({ type: 'pins', src: containerArtId, tgt: listArtId });
        }
        continue;
      }

      switch (widget.type as string) {
        case 'map':
          if (cfg.mapId)        { embeddedId = cfg.mapId;        embeddedOT = 'maps';          embeddedType = 'map';       } break;
        case 'c2': case 'comrel':
          if (cfg.boardId)      { embeddedId = cfg.boardId;      embeddedOT = 'boards';        embeddedType = 'c2board';   } break;
        case 'timeline':
          if (cfg.boardId)      { embeddedId = cfg.boardId;      embeddedOT = 'boards';        embeddedType = 'timeline';  } break;
        case 'whiteboard':
          if (cfg.whiteboardId) { embeddedId = cfg.whiteboardId; embeddedOT = 'whiteboards';   embeddedType = 'whiteboard';} break;
      }

      // Fallback: widgets that directly embed a single card (nodeId) or list (listId/sectionId)
      if (!embeddedId) {
        const nodeId = Number(cfg.nodeId ?? cfg.artifactNodeId ?? 0);
        if (nodeId) {
          const cardArtId = makeId('nodes', nodeId);
          if (!emittedArtifacts.has(cardArtId)) {
            let lbl = `Card ${nodeId}`;
            try { const ns = await collab.nodes.getMany([nodeId]); if (ns[0]) lbl = await resolveNodeLabel(ns[0] as any); } catch { /* ignore */ }
            emitArtifact({ id: cardArtId, type: 'card', label: lbl, plan: planId });
          }
          emitLink({ type: 'pins', src: containerArtId, tgt: cardArtId });
          continue;
        }
        const listId2 = Number(cfg.listId ?? cfg.sectionId ?? 0);
        if (listId2) {
          const listArtId = makeId('sections', listId2);
          if (!emittedArtifacts.has(listArtId)) {
            let lbl = `List ${listId2}`;
            try { const ls = await collab.lists.getMany([listId2]); lbl = (ls as any)?.[0]?.title || lbl; } catch { /* ignore */ }
            emitArtifact({ id: listArtId, type: 'list', label: lbl, plan: planId });
          }
          emitLink({ type: 'pins', src: containerArtId, tgt: listArtId });
          continue;
        }
      }

      if (!embeddedId || !embeddedOT || !embeddedType) continue;

      const embeddedArtId = makeId(embeddedOT, embeddedId);
      const alreadyEmitted = emittedArtifacts.has(embeddedArtId);

      if (!alreadyEmitted) {
        let lbl = 'Untitled';
        try { lbl = (await collab.global.getTitle(embeddedOT, embeddedId)) || lbl; } catch { /* ignore */ }
        emitArtifact({ id: embeddedArtId, type: embeddedType, label: lbl, plan: planId });
        primaryParent.set(embeddedArtId, planId);
        emitLink({ type: 'contains', src: planId, tgt: embeddedArtId });
      }

      emitLink({ type: 'pins', src: containerArtId, tgt: embeddedArtId });

      if (embeddedOT === 'boards' && !boardIds.has(embeddedId)) {
        boardIds.add(embeddedId);
        await fetchBoardInfo(embeddedId);
      }
      if (embeddedOT === 'maps') discoveredMaps.set(embeddedId, embeddedArtId);

      if (embeddedOT === 'whiteboards' && !alreadyEmitted) {
        try {
          const wb = await (collab.whiteboards as any).get(embeddedId);
          if (wb?.widgets?.length) await processWidgets(wb.widgets, embeddedArtId);
        } catch { /* ignore */ }
      }
    }
  }

  for (const [wbId, artId] of discoveredWhiteboards) {
    try { const wb = await (collab.whiteboards as any).get(wbId); if (wb?.widgets?.length) await processWidgets(wb.widgets, artId); } catch { /* ignore */ }
  }

  for (const [presId, artId] of discoveredPresentations) {
    try {
      let slides: any[] = [];
      try { slides = await (collab.presentations as any).getSlides(presId); } catch {
        const pres = await (collab.presentations as any).get(presId);
        for (const slideId of (pres as any)?.slideIds ?? []) {
          try { const sl = await (collab as any).presentation_slides?.get(slideId); if (sl) slides.push(sl); } catch { /* ignore */ }
        }
      }
      for (const slide of slides) {
        const widgets = slide?.widgets ?? slide?.elements ?? [];
        if (widgets.length) await processWidgets(widgets, artId);
      }
    } catch { /* ignore */ }
  }

  async function emitListTableLinks(containerArtId: string, listTableData: any): Promise<void> {
    for (const entry of Object.values(listTableData as any)) {
      const e = entry as any;
      const listId = (e?.settings?.listId ?? e?.listId ?? e?.sectionId) as number | undefined;
      if (!listId) continue;
      const listArtId = makeId('sections', listId);
      if (!emittedArtifacts.has(listArtId)) {
        let lbl = `List ${listId}`;
        try { const ls = await collab.lists.getMany([listId]); lbl = (ls as any)?.[0]?.title || lbl; } catch { /* ignore */ }
        emitArtifact({ id: listArtId, type: 'list', label: lbl, plan: planId });
      }
      emitLink({ type: 'pins', src: containerArtId, tgt: listArtId });
    }
  }

  // Walk a ProseMirror document (plain JSON or PM Node objects).
  // Matches any node that carries a listId / sectionId attr — regardless of the node's
  // type name — so this works even if the PM schema calls the node something unexpected.
  function collectPmListIds(pmNode: any): number[] {
    const ids = new Set<number>();
    function walk(n: any): void {
      if (!n) return;
      if (n.attrs) {
        const id = Number(n.attrs.listId ?? n.attrs.sectionId ?? n.attrs.list_id ?? n.attrs.section_id ?? 0);
        if (id > 0) ids.add(id);
      }
      const children: any[] = Array.isArray(n.content)
        ? n.content
        : (n.childCount != null ? Array.from({ length: n.childCount as number }, (_: unknown, i: number) => (n as any).child(i)) : []);
      for (const child of children) walk(child);
    }
    walk(pmNode);
    return [...ids];
  }

  for (const [docId, artId] of discoveredDocuments) {
    // Attempt 1: getListTablePmNodesData (synchronous cache read — works if doc already loaded)
    try { await (collab.documents as any).get(docId); } catch { /* ignore */ }
    let gotLinks = false;
    try {
      const d = await (collab.documents as any).getListTablePmNodesData(docId);
      if (Object.keys(d as any).length > 0) { await emitListTableLinks(artId, d); gotLinks = true; }
    } catch { /* ignore */ }

    // Attempt 2: walk the PM document tree directly
    if (!gotLinks) {
      try {
        const pmDoc = await collab.documents.getNodeDocument(docId);
        if (pmDoc) {
          for (const listId of collectPmListIds(pmDoc)) {
            const listArtId = makeId('sections', listId);
            if (!emittedArtifacts.has(listArtId)) {
              let lbl = `List ${listId}`;
              try { const ls = await collab.lists.getMany([listId]); lbl = (ls as any)?.[0]?.title || lbl; } catch { /* ignore */ }
              emitArtifact({ id: listArtId, type: 'list', label: lbl, plan: planId });
            }
            emitLink({ type: 'pins', src: artId, tgt: listArtId });
          }
        }
      } catch { /* ignore */ }
    }

    // Scan for inline node embeds (node_embed PM blocks)
    try {
      const nodeEmbeds = await (collab.documents as any).getNodeEmbedPmNodesData?.(docId);
      if (nodeEmbeds) {
        for (const entry of Object.values(nodeEmbeds as any)) {
          const e = entry as any;
          const nodeId = Number(e?.nodeId ?? e?.settings?.nodeId ?? 0);
          if (!nodeId) continue;
          const cardArtId = makeId('nodes', nodeId);
          if (!emittedArtifacts.has(cardArtId)) {
            let lbl = `Card ${nodeId}`;
            try { const ns = await collab.nodes.getMany([nodeId]); if (ns[0]) lbl = await resolveNodeLabel(ns[0] as any); } catch { /* ignore */ }
            emitArtifact({ id: cardArtId, type: 'card', label: lbl, plan: planId });
          }
          emitLink({ type: 'pins', src: artId, tgt: cardArtId });
        }
      }
    } catch { /* ignore */ }
  }

  for (const [orderId, artId] of discoveredOrders) {
    try {
      const order = await (collab as any).orders?.get(orderId);
      const docId: number | undefined = (order as any)?.docId ?? (order as any)?.documentId ?? (order as any)?.document_id;
      if (!docId) continue;

      // collab.documents.get(docId) returns a record with a `snapshot` key
      // containing the ProseMirror JSON tree (card_list nodes carry listId attrs).
      const docRecord: any = await (collab.documents as any).get(docId).catch(() => null);
      if (!docRecord) continue;

      const listIds = collectPmListIds(docRecord.snapshot ?? docRecord);
      for (const listId of listIds) {
        // Only emit pins; do NOT set primaryParent here. Phase 5 will assign
        // each list its correct board parent. Setting planId now would block that.
        emitLink({ type: 'pins', src: artId, tgt: makeId('sections', listId) });
      }
    } catch { /* ignore */ }
  }

  // ── Phase 4: Source doc helper ─────────────────────────────────────────

  async function emitSourceDocLink(cardArtId: string, fileDocId: number, nodeBriefId?: number): Promise<void> {
    if (nodeBriefId != null && nodeBriefId !== briefId) return;
    const fileDocArtId = makeId('file_documents', fileDocId);
    if (!emittedArtifacts.has(fileDocArtId)) {
      let lbl = 'Reference';
      try { lbl = (await collab.global.getTitle('file_documents', fileDocId)) || lbl; } catch { /* ignore */ }
      emitArtifact({ id: fileDocArtId, type: 'reference', label: lbl, plan: planId });
      if (!primaryParent.has(fileDocArtId)) { primaryParent.set(fileDocArtId, planId); emitLink({ type: 'contains', src: planId, tgt: fileDocArtId }); }
    }
    emitLink({ type: 'sourced_from', src: fileDocArtId, tgt: cardArtId });
  }

  // ── Phase 5: Boards ────────────────────────────────────────────────────

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
    emitArtifact({ id: artId, type: displayType, label: info.title || `Board ${boardId}`,
      plan: planId, boardType: rawBoardType, sourceBriefId: (info as any).briefId ?? undefined });

    if (!primaryParent.has(artId)) {
      // If this board lives inside a plan-level section, the section is the primary container.
      // This places the board in allChildren[sectionId] so layoutSection can position it correctly.
      const sectionArtId = boardsInSections.get(boardId);
      if (sectionArtId) {
        primaryParent.set(artId, sectionArtId);
        emitLink({ type: 'contains', src: sectionArtId, tgt: artId });
      } else {
        primaryParent.set(artId, planId);
        emitLink({ type: 'contains', src: planId, tgt: artId });
      }
    }

    const descendantNodes = new Set<number>();
    boardDescendantNodes.set(boardId, descendantNodes);

    if (displayType === 'c2board') await processC2Board(boardId, artId, descendantNodes);
    else if (rawBoardType === 'map') await processDirectNodeBoard(boardId, artId, descendantNodes);
    else await processListBoard(boardId, artId, descendantNodes);
  }

  async function processC2Board(boardId: number, boardArtId: string, descendantNodes: Set<number>): Promise<void> {
    try {
      const units = await collab.c2_units.getBoardUnits(boardId);
      for (const unit of units) {
        const cardArtId = unit.nodeId != null ? makeId('nodes', unit.nodeId) : makeId('c2_units', unit.id);
        const lbl = await resolveC2UnitLabel(unit.id);
        emitArtifact({ id: cardArtId, type: 'card', label: lbl, plan: planId, sourceBriefId: (unit as any).briefId ?? undefined });
        if (primaryParent.has(cardArtId)) emitLink({ type: 'pins', src: boardArtId, tgt: cardArtId });
        else { primaryParent.set(cardArtId, boardArtId); emitLink({ type: 'contains', src: boardArtId, tgt: cardArtId }); }
        if (unit.nodeId != null) {
          descendantNodes.add(unit.nodeId);
          try {
            const un = await collab.c2_units.getUnitNode(unit.id);
            const fd = (un as any)?.fileDocumentId as number | null | undefined;
            if (fd) await emitSourceDocLink(cardArtId, fd, (unit as any).briefId as number | undefined);
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  async function processDirectNodeBoard(boardId: number, boardArtId: string, descendantNodes: Set<number>): Promise<void> {
    try {
      const nodes = await collab.boards.getNodes(boardId);
      for (const node of nodes) {
        if (!node) continue;
        const cardArtId = makeId('nodes', node.id);
        const lbl = await resolveNodeLabel(node as any);
        emitArtifact({ id: cardArtId, type: 'card', label: lbl, plan: planId,
          sourceBriefId: (node as any).briefId ?? undefined,
          createdAt: node.createdAt ? new Date(node.createdAt).toISOString() : undefined });
        if (primaryParent.has(cardArtId)) emitLink({ type: 'pins', src: boardArtId, tgt: cardArtId });
        else { primaryParent.set(cardArtId, boardArtId); emitLink({ type: 'contains', src: boardArtId, tgt: cardArtId }); }
        descendantNodes.add(node.id);
        const fd = (node as any).fileDocumentId as number | null | undefined;
        if (fd) await emitSourceDocLink(cardArtId, fd, (node as any).briefId as number | undefined);
      }
    } catch { /* ignore */ }
  }

  async function processListBoard(boardId: number, boardArtId: string, descendantNodes: Set<number>): Promise<void> {
    try {
      const lists = await collab.boards.getLists(boardId);
      for (const list of lists) {
        const listArtId = makeId('sections', list.id);
        let listLabel = list.title || '';
        if (!listLabel) {
          try { const fl = await collab.lists.getMany([list.id]); listLabel = (fl as any)?.[0]?.title || ''; } catch { /* ignore */ }
        }
        emitArtifact({ id: listArtId, type: 'list', label: listLabel || `List ${list.id}`,
          plan: planId, sourceBriefId: (list as any).briefId ?? undefined,
          createdAt: list.createdAt ? new Date(list.createdAt).toISOString() : undefined });
        if (!primaryParent.has(listArtId)) { primaryParent.set(listArtId, boardArtId); emitLink({ type: 'contains', src: boardArtId, tgt: listArtId }); }
        else emitLink({ type: 'pins', src: boardArtId, tgt: listArtId });

        try {
          const nodeIds = await collab.lists.getNodeIds(list.id);
          if (nodeIds.length > 0) {
            const nodes = await collab.nodes.getMany(nodeIds);
            for (const node of nodes) {
              const cardArtId = makeId('nodes', node.id);
              const lbl = await resolveNodeLabel(node as any);
              emitArtifact({ id: cardArtId, type: 'card', label: lbl, plan: planId,
                sourceBriefId: (node as any).briefId ?? undefined,
                createdAt: node.createdAt ? new Date(node.createdAt).toISOString() : undefined });
              emitLink({ type: 'contains', src: listArtId, tgt: cardArtId });
              if (!primaryParent.has(cardArtId)) { primaryParent.set(cardArtId, listArtId); descendantNodes.add(node.id); }
              const fd = (node as any).fileDocumentId as number | null | undefined;
              if (fd) await emitSourceDocLink(cardArtId, fd, (node as any).briefId as number | undefined);
            }
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  for (const boardId of sortedBoardIds) await processBoard(boardId);

  // ── Phase 5.5: Map overlay pins ────────────────────────────────────────
  // (runs before the fallback pass so any lists discovered here can still be claimed)

  for (const [mapNumericId, mapArtId] of discoveredMaps) {
    try {
      const map = await (collab.maps as any).get(mapNumericId);
      for (const overlayId of (map as any)?.overlayIds ?? []) {
        try {
          const overlay = await (collab as any).map_overlays?.get(overlayId);
          for (const feature of (overlay as any)?.features ?? []) {
            const props = (feature as any).properties;
            const cardNumId = props?.nodeId ?? props?.user_nodeId;
            const listNumId = props?.listId ?? props?.user_listId;
            if (cardNumId) {
              const cardArtId = makeId('nodes', cardNumId);
              if (emittedArtifacts.has(cardArtId)) emitLink({ type: 'pins', src: mapArtId, tgt: cardArtId });
            }
            if (listNumId) {
              const listArtId = makeId('sections', listNumId);
              if (!emittedArtifacts.has(listArtId)) {
                let lbl = `List ${listNumId}`;
                try { const ls = await collab.lists.getMany([listNumId]); lbl = (ls as any)?.[0]?.title || lbl; } catch { /* ignore */ }
                emitArtifact({ id: listArtId, type: 'list', label: lbl, plan: planId });
              }
              emitLink({ type: 'pins', src: mapArtId, tgt: listArtId });
            }
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  // ── Phase 5.9: Fallback parent assignment ─────────────────────────────
  // Any artifact emitted in earlier phases (whiteboards, presentations, documents,
  // orders, map overlays) without a primaryParent falls back to planId so it doesn't
  // end up orphaned in the layout.
  for (const artId of emittedArtifacts) {
    if (artId !== planId && !primaryParent.has(artId)) {
      primaryParent.set(artId, planId);
      emitLink({ type: 'contains', src: planId, tgt: artId });
    }
  }

  // ── Phase 6: C&E upgrade ───────────────────────────────────────────────

  try {
    const allEdges = await collab.edges.getAll();
    const nodeToBoardIds = new Map<number, Set<number>>();
    for (const [bId, nodeSet] of boardDescendantNodes) {
      for (const nId of nodeSet) {
        if (!nodeToBoardIds.has(nId)) nodeToBoardIds.set(nId, new Set());
        nodeToBoardIds.get(nId)!.add(bId);
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
      const existing = artifacts.find(a => a.id === makeId('boards', bid));
      if (existing) existing.type = 'cause_effect';
    }
  } catch { /* ignore */ }

  // ── Phase 7: Outgoing cross-plan sync detection ────────────────────────
  // Batched: one parallel getListIds per card, then a single getMany for all
  // discovered list IDs. Reduces from O(N*M) sequential awaits to two rounds.

  const nativeCardPairs = artifacts
    .filter(a => a.type === 'card' && (a.sourceBriefId == null || a.sourceBriefId === briefId))
    .map(art => ({ art, numId: parseInt(art.id.replace('nodes_', ''), 10) }))
    .filter(({ numId }) => !isNaN(numId));

  if (nativeCardPairs.length > 0) {
    const listIdResults = await Promise.allSettled(
      nativeCardPairs.map(({ numId }) => collab.nodes.getListIds(numId))
    );

    const allListIdSet = new Set<number>();
    for (const r of listIdResults) {
      if (r.status === 'fulfilled') r.value.forEach(id => allListIdSet.add(id));
    }

    const listBriefIdMap = new Map<number, number>();
    if (allListIdSet.size > 0) {
      try {
        const lists = await collab.lists.getMany([...allListIdSet]);
        for (const list of lists as any[]) {
          if (list?.id != null && list?.briefId != null) listBriefIdMap.set(list.id, list.briefId);
        }
      } catch { /* ignore */ }
    }

    for (let i = 0; i < nativeCardPairs.length; i++) {
      const r = listIdResults[i];
      if (r.status !== 'fulfilled') continue;
      const otherBriefIds = [...new Set(
        r.value
          .map(lid => listBriefIdMap.get(lid))
          .filter((bid): bid is number => bid != null && bid !== briefId)
      )];
      if (otherBriefIds.length > 0) {
        nativeCardPairs[i].art.syncedToOtherPlans = true;
        nativeCardPairs[i].art.syncedPlanBriefIds = otherBriefIds;
      }
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    plan: { id: briefId, title: briefTitle },
    artifacts,
    links,
  };
}
