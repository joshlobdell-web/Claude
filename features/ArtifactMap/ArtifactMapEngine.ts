/**
 * ArtifactMapEngine
 *
 * Self-contained Canvas rendering engine for the Artifact Map overlay.
 * Extracted from artifact-map.html and adapted for Onebrief's React context.
 *
 * Usage:
 *   const engine = new ArtifactMapEngine(containerEl, { onClose: () => setOpen(false) });
 *   engine.loadData(artifactMapData);
 *   // later:
 *   engine.destroy();
 */

import type { ArtifactMapData } from './getArtifactMapData';

// ─── Config ────────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { tier: number; color: string; bg: string; label: string }> = {
  card:         { tier: 0,  color: '#5b687b', bg: '#ffffff',  label: 'Card'         },
  list:         { tier: 1,  color: '#198754', bg: '#edfaf3',  label: 'List'         },
  section:      { tier: 4.5, color: '#4f46e5', bg: '#eef2ff',  label: 'Section'      },
  board:        { tier: 2,  color: '#3170aa', bg: '#e8f1fa',  label: 'List Board'   },
  c2board:      { tier: 3,  color: '#198754', bg: '#edfaf3',  label: 'C2 Diagram'   },
  timeline:     { tier: 3,  color: '#9a6700', bg: '#fef8e8',  label: 'Timeline'     },
  map:          { tier: 3,  color: '#bc4c00', bg: '#fef3ea',  label: 'Map'          },
  whiteboard:   { tier: 3,  color: '#6f46a6', bg: '#f3eeff',  label: 'Whiteboard'   },
  cause_effect: { tier: 3,  color: '#dc3545', bg: '#fef0f0',  label: 'C&E'          },
  presentation: { tier: 4,  color: '#dc3545', bg: '#fef0f0',  label: 'Presentation' },
  document:     { tier: 4,  color: '#5b687b', bg: '#f8f9fa',  label: 'Document'     },
  plan:         { tier: 5,  color: '#7357ff', bg: '#f0ecff',  label: 'Plan'         },
  reference:    { tier: -1, color: '#3170aa', bg: '#e8f1fa',  label: 'Reference'    },
};

const TYPE_ALIAS: Record<string, string> = { mapboard: 'map', order: 'document', c2unit: 'card' };

const LINK_CONFIG: Record<string, { color: string; dash: number[]; label: string }> = {
  contains:     { color: '#3170aa', dash: [],     label: 'contains'    },
  ghost:        { color: '#7357ff', dash: [7, 4], label: 'synced from' },
  pins:         { color: '#fd7e14', dash: [4, 3], label: 'pins'        },
  sourced_from: { color: '#198754', dash: [5, 3], label: 'source doc'  },
};

const NODE_W         = 158;
const NODE_H         = 50;
const H_GAP          = 14;
const PLAN_GAP       = 80;
const CARD_STACK_MAX = 10;
const MAX_COLS_PER_ROW = 3;
const V_CARD_STEP    = 64;
const CARD_ROW_GAP   = 80;

const TIER_Y: Record<string, number> = { '5': 40, '4.5': 150, '4': 280, '3': 440, '2': 600, '1': 780, '0': 980, '-1': 2200 };

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Pos { x: number; y: number }
interface PlanBounds { x: number; y: number; w: number; h: number }
interface ArtEntry { [key: string]: any }
interface LinkEntry { type: string; src: string; tgt: string }

// ─── Engine ────────────────────────────────────────────────────────────────────

export class ArtifactMapEngine {
  private container: HTMLElement;
  private onClose: () => void;

  // DOM refs
  private appEl!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private tierLabelsEl!: HTMLElement;
  private mainCanvas!: HTMLCanvasElement;
  private mCtx!: CanvasRenderingContext2D;
  private canvasWrap!: HTMLElement;
  private sidebar!: HTMLElement;
  private sbTypeBadge!: HTMLElement;
  private sbTitle!: HTMLElement;
  private sbPlan!: HTMLElement;
  private sbActions!: HTMLElement;
  private sbConnections!: HTMLElement;
  private btnReset!: HTMLButtonElement;
  private btnImpact!: HTMLButtonElement;
  private btnFocus!: HTMLButtonElement;
  private planPillsEl!: HTMLElement;
  private focusOverlay!: HTMLElement;
  private focusTitleEl!: HTMLElement;
  private focusCloseEl!: HTMLButtonElement;
  private focusCanvas!: HTMLCanvasElement;
  private fCtx!: CanvasRenderingContext2D;
  private focusWrap!: HTMLElement;
  private styleEl!: HTMLStyleElement;

  // State
  private allArtifacts: Record<string, ArtEntry> = {};
  private allLinks:     LinkEntry[]               = [];
  private planMeta:     Record<string, { id: number; title: string }> = {};
  private nodePos:      Record<string, Pos>        = {};
  private planBounds:   Record<string, PlanBounds> = {};
  private canonicalOf:     Record<string, string>  = {};
  private primaryVisualOf: Record<string, string>  = {};
  private loadedPlans: ArtifactMapData[]           = [];
  private tierY:        Record<string, number>                              = { ...TIER_Y };
  private tierBandBounds:      Record<string, { top: number; bottom: number }> = {};
  private focusTierBandBounds: Record<string, { top: number; bottom: number }> = {};
  private focusTierY:          Record<string, number>                           = {};

  private selectedId:   string | null = null;
  private modeImpact   = false;
  private focusLayout  = false;  // true during buildFocusLayout — suppresses virtual card IDs

  // Main canvas pan/zoom
  private panX = 0; private panY = 0; private scale = 1;
  private isPanning = false;
  private panSX = 0; private panSY = 0; private panSPX = 0; private panSPY = 0;

  // Focus canvas pan/zoom
  private fPanX = 0; private fPanY = 0; private fScale = 1;
  private fIsPanning = false;
  private fPanSX = 0; private fPanSY = 0; private fPanSPX = 0; private fPanSPY = 0;

  private focusOpen            = false;
  private focusNodeIds:        string[]                = [];
  private focusNodePos:        Record<string, Pos>     = {};
  private focusPlanBounds:     Record<string, PlanBounds> = {};
  private focusCanonicalOf:    Record<string, string>  = {};
  private focusPrimaryVisualOf: Record<string, string> = {};

  // Stored event handlers for cleanup
  private resizeHandler!:      () => void;
  private keydownHandler!:     (e: KeyboardEvent) => void;
  private layersClickHandler!: (e: MouseEvent) => void;

  // Feature state
  private hiddenTiers:  Set<string>       = new Set();
  private tooltipEl!:   HTMLElement;
  private btnLayers!:   HTMLButtonElement;
  private layersPanel!: HTMLElement;
  private btnAddPlan!:          HTMLButtonElement;
  private btnFullscreen!:       HTMLButtonElement;
  private onAddPlanCb:          (() => void) | null = null;
  private onToggleFullscreenCb: (() => void) | null = null;

  constructor(container: HTMLElement, options: { onClose: () => void; onAddPlan?: () => void; onToggleFullscreen?: () => void }) {
    this.container = container;
    this.onClose = options.onClose;
    this.onAddPlanCb = options.onAddPlan ?? null;
    this.onToggleFullscreenCb = options.onToggleFullscreen ?? null;
    this.buildDOM();
    this.queryRefs();
    this.setupEvents();
    this.resizeCanvas();
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  public loadData(data: ArtifactMapData | ArtifactMapData[]): void {
    const items = Array.isArray(data) ? data : [data];
    for (const d of items) {
      if (d && Array.isArray(d.artifacts) && Array.isArray(d.links)) {
        this.loadedPlans.push(d);
      }
    }
    if (this.loadedPlans.length) {
      this.showApp();
      this.mergeAndRender();
    }
  }

  public setFullscreen(isFullscreen: boolean): void {
    this.btnFullscreen.textContent = isFullscreen ? '⛶ Exit Full' : '⛶ Fullscreen';
    requestAnimationFrame(() => { this.resizeCanvas(); this.fitViewMain(); });
  }

  public destroy(): void {
    window.removeEventListener('resize', this.resizeHandler);
    document.removeEventListener('keydown', this.keydownHandler);
    document.removeEventListener('click', this.layersClickHandler);
    this.container.innerHTML = '';
  }

  // ─── DOM Construction ────────────────────────────────────────────────────────

  private buildDOM(): void {
    this.container.style.cssText = 'position:relative;width:100%;height:100%;background:#f8f9fa;overflow:hidden;';

    const style = document.createElement('style');
    style.textContent = `
      .am-root *, .am-root *::before, .am-root *::after { box-sizing: border-box; margin: 0; padding: 0; }
      .am-root {
        color: #212529;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 0.875rem;
      }
      .am-toolbar {
        position: absolute; top: 0; left: 0; right: 0; height: 44px; z-index: 50;
        background: #ffffff;
        border-bottom: 1px solid #dde2e9;
        display: flex; align-items: center; gap: 4px; padding: 0 10px; overflow-x: auto;
      }
      .am-toolbar-title {
        font-size: 0.75rem; font-weight: 500; color: #5b687b;
        letter-spacing: 0.05em; text-transform: uppercase;
        padding: 0 6px; flex-shrink: 0; user-select: none;
      }
      .am-tb-group {
        display: inline-flex; align-items: stretch; flex-shrink: 0;
        background: transparent; border: 1px solid #dde2e9; border-radius: 0.375rem; overflow: hidden;
      }
      .am-tb-btn {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 0.25rem 0.625rem;
        border: none; border-radius: 0;
        background: transparent; color: #212529;
        font-size: 0.8125rem; font-weight: 400; font-family: inherit; line-height: 1.5;
        cursor: pointer; white-space: nowrap; flex-shrink: 0;
        transition: background-color 0.1s ease, color 0.1s ease;
      }
      .am-tb-btn + .am-tb-btn { border-left: 1px solid #dde2e9; }
      .am-tb-btn:first-child { border-radius: 0.375rem 0 0 0.375rem; }
      .am-tb-btn:last-child  { border-radius: 0 0.375rem 0.375rem 0; }
      .am-tb-btn:only-child  { border-radius: 0.375rem; }
      .am-tb-btn:hover:not(:disabled) { background: #f8f9fa; color: #212529; }
      .am-tb-btn.active { background: #e8f1fa; color: #3170aa; }
      .am-tb-btn.active:hover { background: #d8eaf7; color: #3170aa; }
      .am-tb-btn.danger { color: #dc3545; }
      .am-tb-btn.danger:hover:not(:disabled) { background: #fef0f0; color: #dc3545; }
      .am-tb-btn:disabled { opacity: 0.35; cursor: default; }
      .am-tb-sep { width: 1px; background: #dde2e9; height: 1.25rem; align-self: center; margin: 0 2px; flex-shrink: 0; }
      .am-tb-spacer { flex: 1; min-width: 8px; }
      .am-plan-pill {
        padding: 1px 8px; border-radius: 50rem; font-size: 0.6875rem; font-weight: 500; border: 1px solid;
        cursor: default; white-space: nowrap; max-width: 160px;
        overflow: hidden; text-overflow: ellipsis; flex-shrink: 0;
      }
      .am-plan-pills { display: flex; gap: 4px; align-items: center; flex-shrink: 0; }
      .am-canvas-wrap { position: absolute; top: 44px; left: 0; right: 0; bottom: 0; overflow: hidden; background: #f8f9fa; }
      .am-canvas-wrap canvas { display: block; cursor: grab; }
      .am-canvas-wrap canvas.grabbing { cursor: grabbing; }
      .am-tier-labels { display: none; }
      .am-tier-label  { display: none; }
      .am-sidebar {
        position: absolute; top: 44px; right: 0; bottom: 0; width: 280px;
        background: #ffffff;
        border-left: 1px solid #dde2e9;
        overflow-y: auto; padding: 12px;
        display: flex; flex-direction: column; gap: 6px; z-index: 20;
        transform: translateX(100%);
        transition: transform 0.18s ease;
        box-shadow: -2px 0 8px rgba(0,0,0,0.06);
      }
      .am-sidebar.open { transform: translateX(0); }
      .am-sb-type-badge {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 1px 6px; border-radius: 0.25rem; font-size: 0.625rem;
        font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; border: 1px solid;
      }
      .am-sb-title { font-size: 0.875rem; font-weight: 600; color: #212529; line-height: 1.4; word-break: break-word; }
      .am-sb-plan  { font-size: 0.6875rem; color: #5b687b; }
      .am-sb-close {
        flex-shrink: 0; background: none; border: none; color: #adb5bd;
        cursor: pointer; font-size: 0.875rem; line-height: 1; padding: 0 2px;
        transition: color 0.1s;
      }
      .am-sb-close:hover { color: #5b687b; }
      .am-sb-action {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 3px 10px; border-radius: 0.375rem;
        border: 1px solid #dde2e9; background: #fff; color: #5b687b;
        font-size: 0.75rem; font-family: inherit; cursor: pointer;
        transition: background 0.1s, color 0.1s;
      }
      .am-sb-action:hover { background: #f8f9fa; color: #212529; }
      .am-sb-section-title {
        font-size: 0.5625rem; color: #adb5bd; text-transform: uppercase;
        letter-spacing: 0.1em; margin-bottom: 2px; margin-top: 8px;
      }
      .am-sb-item {
        display: flex; align-items: center; gap: 7px;
        padding: 4px 6px; border-radius: 0.375rem;
        cursor: pointer; transition: background 0.1s; font-size: 0.75rem; color: #5b687b;
      }
      .am-sb-item:hover { background: #f8f9fa; color: #212529; }
      .am-sb-item-dot   { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
      .am-sb-item-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .am-sb-badge {
        font-size: 0.5625rem; font-weight: 600; padding: 1px 5px;
        border-radius: 0.25rem; background: #f8f9fa; border: 1px solid #dde2e9;
        color: #5b687b; flex-shrink: 0;
      }
      .am-sb-badge.d1 { background: rgba(49,112,170,0.1); border-color: rgba(49,112,170,0.25); color: #3170aa; }
      .am-sb-badge.d2 { background: rgba(154,103,0,0.1); border-color: rgba(154,103,0,0.25); color: #9a6700; }
      .am-sb-badge.d3 { background: rgba(220,53,69,0.1); border-color: rgba(220,53,69,0.25); color: #dc3545; }
      .am-focus-overlay {
        position: absolute; inset: 0; z-index: 200;
        background: rgba(248,249,250,0.98); display: none; flex-direction: column;
      }
      .am-focus-overlay.visible { display: flex; }
      .am-focus-header {
        height: 44px; background: #ffffff;
        border-bottom: 1px solid #dde2e9;
        display: flex; align-items: center; padding: 0 16px; gap: 12px; flex-shrink: 0;
      }
      .am-focus-title { font-size: 0.875rem; font-weight: 600; color: #212529; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .am-focus-close {
        padding: 0.25rem 0.75rem; border-radius: 0.375rem;
        border: 1px solid #dde2e9;
        background: #ffffff; color: #5b687b; cursor: pointer;
        font-size: 0.8125rem; font-weight: 400; flex-shrink: 0; font-family: inherit;
        transition: background-color 0.1s, color 0.1s;
      }
      .am-focus-close:hover { background: #f8f9fa; color: #212529; }
      .am-focus-canvas-wrap { flex: 1; overflow: hidden; position: relative; background: #f8f9fa; }
      .am-focus-canvas-wrap canvas { display: block; cursor: grab; }
      .am-focus-canvas-wrap canvas.grabbing { cursor: grabbing; }
      .am-layers-wrapper { position: relative; display: inline-flex; align-items: center; flex-shrink: 0; }
      .am-layers-wrapper .am-tb-btn { border: 1px solid #dde2e9; border-radius: 0.375rem; }
      .am-layers-panel {
        position: absolute; z-index: 300;
        background: #ffffff; border: 1px solid #dde2e9; border-radius: 0.375rem;
        padding: 6px; min-width: 180px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      }
      .am-layers-panel.hidden { display: none; }
      .am-layers-item {
        display: flex; align-items: center; gap: 8px;
        padding: 4px 6px; border-radius: 0.25rem; cursor: pointer;
        font-size: 0.75rem; color: #5b687b; user-select: none;
      }
      .am-layers-item:hover { background: #f8f9fa; }
      .am-layers-item input[type=checkbox] { cursor: pointer; accent-color: #3170aa; }
      .am-layers-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .am-tooltip {
        position: absolute; z-index: 400; pointer-events: none;
        background: #1e2530; color: #f0f4f8; border-radius: 0.3rem;
        padding: 4px 8px; font-size: 0.6875rem; font-weight: 500;
        white-space: nowrap; opacity: 0; transition: opacity 0.1s;
        transform: translate(-50%, calc(-100% - 10px));
      }
      .am-tooltip.visible { opacity: 1; }
      .am-root ::-webkit-scrollbar { width: 4px; }
      .am-root ::-webkit-scrollbar-track { background: transparent; }
      .am-root ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.18); border-radius: 2px; }
    `;
    this.container.appendChild(style);
    this.styleEl = style;

    this.container.insertAdjacentHTML('beforeend', `
      <div class="am-root" style="position:absolute;inset:0;">
        <div class="am-toolbar" id="am-toolbar">
          <span class="am-toolbar-title" id="am-toolbar-title">Artifact Syncs</span>
          <div class="am-tb-sep"></div>
          <div class="am-tb-group">
            <button class="am-tb-btn" id="am-btn-reset">Reset View</button>
          </div>
          <div class="am-tb-group">
            <button class="am-tb-btn" id="am-btn-impact">Impact</button>
            <button class="am-tb-btn" id="am-btn-focus" disabled>Focus</button>
          </div>
          <div class="am-tb-sep"></div>
          <div class="am-layers-wrapper">
            <button class="am-tb-btn" id="am-btn-layers">Layers ▾</button>
          </div>
          <div class="am-tb-sep"></div>
          <div class="am-tb-group">
            <button class="am-tb-btn" id="am-btn-add-plan">＋ Plan</button>
          </div>
          <div class="am-tb-sep"></div>
          <div class="am-plan-pills" id="am-plan-pills"></div>
          <div class="am-tb-spacer"></div>
          <div class="am-tb-group">
            <button class="am-tb-btn" id="am-btn-fullscreen" title="Toggle fullscreen">⛶ Fullscreen</button>
            <button class="am-tb-btn" id="am-btn-close">Close</button>
          </div>
        </div>

        <div class="am-layers-panel hidden" id="am-layers-panel"></div>

        <div class="am-tier-labels" id="am-tier-labels">
          <div class="am-tier-label" id="am-tl-5">PLAN</div>
          <div class="am-tier-label" id="am-tl-sections">SECTIONS</div>
          <div class="am-tier-label" id="am-tl-4">OUTPUT<br>PRODUCTS</div>
          <div class="am-tier-label" id="am-tl-3">VISUAL<br>TOOLS</div>
          <div class="am-tier-label" id="am-tl-2">LIST<br>BOARDS</div>
          <div class="am-tier-label" id="am-tl-1">LISTS / SECTIONS</div>
          <div class="am-tier-label" id="am-tl-0">CARDS</div>
          <div class="am-tier-label" id="am-tl-ref">UPLOADED<br>REFS</div>
        </div>

        <div class="am-canvas-wrap" id="am-canvas-wrap">
          <canvas id="am-main-canvas"></canvas>
        </div>

        <div class="am-sidebar" id="am-sidebar">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;">
            <span class="am-sb-type-badge" id="am-sb-type-badge"></span>
            <button class="am-sb-close" id="am-sb-close" title="Close">✕</button>
          </div>
          <div class="am-sb-title" id="am-sb-title"></div>
          <div class="am-sb-plan"  id="am-sb-plan"></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;" id="am-sb-actions"></div>
          <div id="am-sb-connections"></div>
        </div>

        <div class="am-focus-overlay" id="am-focus-overlay">
          <div class="am-focus-header">
            <span class="am-focus-title" id="am-focus-title">Focus</span>
            <button class="am-focus-close" id="am-focus-close">← Back</button>
          </div>
          <div class="am-focus-canvas-wrap" id="am-focus-canvas-wrap">
            <canvas id="am-focus-canvas"></canvas>
          </div>
        </div>
        <div class="am-tooltip" id="am-tooltip"></div>
      </div>
    `);
  }

  private queryRefs(): void {
    const q = <T extends HTMLElement>(id: string) => this.container.querySelector<T>(`#${id}`)!;
    this.toolbarEl     = q('am-toolbar');
    this.tierLabelsEl  = q('am-tier-labels');
    this.mainCanvas    = q<HTMLCanvasElement>('am-main-canvas');
    this.mCtx          = this.mainCanvas.getContext('2d')!;
    this.canvasWrap    = q('am-canvas-wrap');
    this.sidebar       = q('am-sidebar');
    this.sbTypeBadge   = q('am-sb-type-badge');
    this.sbTitle       = q('am-sb-title');
    this.sbPlan        = q('am-sb-plan');
    this.sbActions     = q('am-sb-actions');
    this.sbConnections = q('am-sb-connections');
    this.btnReset      = q<HTMLButtonElement>('am-btn-reset');
    this.btnImpact     = q<HTMLButtonElement>('am-btn-impact');
    this.btnFocus      = q<HTMLButtonElement>('am-btn-focus');
    this.planPillsEl   = q('am-plan-pills');
    this.focusOverlay  = q('am-focus-overlay');
    this.focusTitleEl  = q('am-focus-title');
    this.focusCloseEl  = q<HTMLButtonElement>('am-focus-close');
    this.focusCanvas   = q<HTMLCanvasElement>('am-focus-canvas');
    this.fCtx          = this.focusCanvas.getContext('2d')!;
    this.focusWrap     = q('am-focus-canvas-wrap');
    this.tooltipEl      = q('am-tooltip');
    this.btnLayers      = q<HTMLButtonElement>('am-btn-layers');
    this.layersPanel    = q('am-layers-panel');
    this.btnAddPlan     = q<HTMLButtonElement>('am-btn-add-plan');
    this.btnFullscreen  = q<HTMLButtonElement>('am-btn-fullscreen');
  }

  private showApp(): void {
    this.toolbarEl.style.display    = 'flex';
    // tier labels drawn on canvas via drawTierLabels()
    this.canvasWrap.style.display   = 'block';
  }

  // ─── Event Setup ─────────────────────────────────────────────────────────────

  private setupEvents(): void {
    this.btnReset.addEventListener('click', () => { this.resizeCanvas(); this.fitViewMain(); });

    this.btnImpact.addEventListener('click', () => {
      this.modeImpact = !this.modeImpact;
      this.btnImpact.classList.toggle('active', this.modeImpact);
      this.updateSidebar(); this.renderAll();
      if (this.focusOpen) this.renderFocus();
    });

    this.btnFocus.addEventListener('click', () => this.openFocus());
    this.focusCloseEl.addEventListener('click', () => this.closeFocus());

    const q = (id: string) => this.container.querySelector<HTMLButtonElement>(`#${id}`)!;
    q('am-sb-close').addEventListener('click', () => this.clearSelection());
    q('am-btn-close').addEventListener('click', () => this.onClose());

    // Main canvas interaction
    this.mainCanvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        const hit = this.hitTest(e.offsetX, e.offsetY, this.nodePos, this.panX, this.panY, this.scale);
        if (hit) { this.selectNode(hit); return; }
        this.clearSelection();
        this.isPanning = true;
        this.panSX = e.clientX; this.panSY = e.clientY;
        this.panSPX = this.panX; this.panSPY = this.panY;
        this.mainCanvas.classList.add('grabbing');
      }
      if (e.button === 1) {
        e.preventDefault();
        this.isPanning = true;
        this.panSX = e.clientX; this.panSY = e.clientY;
        this.panSPX = this.panX; this.panSPY = this.panY;
        this.mainCanvas.classList.add('grabbing');
      }
    });

    this.mainCanvas.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.panX = this.panSPX + (e.clientX - this.panSX);
        this.panY = this.panSPY + (e.clientY - this.panSY);
        this.renderAll();
        this.updateTooltip(null, 0, 0);
      } else {
        const hit = this.hitTest(e.offsetX, e.offsetY, this.nodePos, this.panX, this.panY, this.scale);
        this.updateTooltip(hit ? this.allArtifacts[hit] : null, e.offsetX, e.offsetY);
      }
    });

    this.mainCanvas.addEventListener('mouseup', () => { this.isPanning = false; this.mainCanvas.classList.remove('grabbing'); });
    this.mainCanvas.addEventListener('mouseleave', () => {
      this.isPanning = false;
      this.mainCanvas.classList.remove('grabbing');
      this.updateTooltip(null, 0, 0);
    });

    this.mainCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f  = e.deltaY < 0 ? 1.1 : 0.9;
      const ns = Math.max(0.05, Math.min(5, this.scale * f));
      this.panX  = e.offsetX - (e.offsetX - this.panX) * (ns / this.scale);
      this.panY  = e.offsetY - (e.offsetY - this.panY) * (ns / this.scale);
      this.scale = ns;
      this.renderAll();
    }, { passive: false });

    // Focus canvas interaction
    this.focusCanvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        const hit = this.hitTest(e.offsetX, e.offsetY, this.focusNodePos, this.fPanX, this.fPanY, this.fScale, this.focusCanonicalOf);
        if (hit) { this.selectNode(hit); this.renderFocus(); return; }
        this.fIsPanning = true;
        this.fPanSX = e.clientX; this.fPanSY = e.clientY;
        this.fPanSPX = this.fPanX; this.fPanSPY = this.fPanY;
        this.focusCanvas.classList.add('grabbing');
      }
      if (e.button === 1) {
        e.preventDefault();
        this.fIsPanning = true;
        this.fPanSX = e.clientX; this.fPanSY = e.clientY;
        this.fPanSPX = this.fPanX; this.fPanSPY = this.fPanY;
        this.focusCanvas.classList.add('grabbing');
      }
    });

    this.focusCanvas.addEventListener('mousemove', (e) => {
      if (!this.fIsPanning) return;
      this.fPanX = this.fPanSPX + (e.clientX - this.fPanSX);
      this.fPanY = this.fPanSPY + (e.clientY - this.fPanSY);
      this.renderFocus();
    });

    this.focusCanvas.addEventListener('mouseup',    () => { this.fIsPanning = false; this.focusCanvas.classList.remove('grabbing'); });
    this.focusCanvas.addEventListener('mouseleave', () => { this.fIsPanning = false; this.focusCanvas.classList.remove('grabbing'); });

    this.focusCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f   = e.deltaY < 0 ? 1.1 : 0.9;
      const ns  = Math.max(0.05, Math.min(5, this.fScale * f));
      this.fPanX  = e.offsetX - (e.offsetX - this.fPanX) * (ns / this.fScale);
      this.fPanY  = e.offsetY - (e.offsetY - this.fPanY) * (ns / this.fScale);
      this.fScale = ns;
      this.renderFocus();
    }, { passive: false });

    // Window resize
    this.resizeHandler = () => {
      this.resizeCanvas(); this.renderAll();
      if (this.focusOpen) this.renderFocus();
    };
    window.addEventListener('resize', this.resizeHandler);

    // ESC key
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!this.layersPanel.classList.contains('hidden')) { this.layersPanel.classList.add('hidden'); return; }
        if (this.focusOpen) { this.closeFocus(); return; }
        this.onClose();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);

    // Layers panel toggle — position relative to container so it escapes toolbar overflow clipping
    this.btnLayers.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.layersPanel.classList.contains('hidden')) {
        const btnRect = this.btnLayers.getBoundingClientRect();
        const cRect   = this.container.getBoundingClientRect();
        this.layersPanel.style.top  = (btnRect.bottom - cRect.top + 4) + 'px';
        this.layersPanel.style.left = (btnRect.left - cRect.left) + 'px';
      }
      this.layersPanel.classList.toggle('hidden');
    });

    // Close layers panel when clicking outside
    this.layersClickHandler = (e: MouseEvent) => {
      if (!this.layersPanel.classList.contains('hidden') &&
          !this.layersPanel.contains(e.target as Node) &&
          e.target !== this.btnLayers) {
        this.layersPanel.classList.add('hidden');
      }
    };
    document.addEventListener('click', this.layersClickHandler);

    // Add Plan button
    this.btnAddPlan.addEventListener('click', () => {
      if (this.onAddPlanCb) this.onAddPlanCb();
    });

    // Fullscreen toggle
    this.btnFullscreen.addEventListener('click', () => {
      if (this.onToggleFullscreenCb) this.onToggleFullscreenCb();
    });
  }

  // ─── Merge + Render Pipeline ─────────────────────────────────────────────────

  private mergeAndRender(): void {
    this.allArtifacts = {};
    this.allLinks     = [];
    this.planMeta     = {};

    for (const data of this.loadedPlans) {
      const pId = 'plan_' + data.plan.id;
      this.planMeta[pId] = { id: data.plan.id, title: data.plan.title };
      for (const art of data.artifacts) {
        const isCross = art.sourceBriefId != null && art.sourceBriefId !== data.plan.id;
        const existing = this.allArtifacts[art.id];
        if (!existing || (!isCross && existing.crossPlan)) {
          this.allArtifacts[art.id] = { ...art, crossPlan: isCross };
        }
      }
    }

    // Merge links (deduplicate)
    const linkKeys = new Set<string>();
    for (const data of this.loadedPlans) {
      for (const lk of data.links) {
        const key = lk.type + ':' + lk.src + ':' + lk.tgt;
        if (!linkKeys.has(key)) {
          linkKeys.add(key);
          this.allLinks.push({ ...lk });
        }
      }
    }

    // Ghost mechanism
    const seenInPlans: Record<string, string[]> = {};
    for (const data of this.loadedPlans) {
      const pId = 'plan_' + data.plan.id;
      for (const art of data.artifacts) {
        if (!seenInPlans[art.id]) seenInPlans[art.id] = [];
        seenInPlans[art.id].push(pId);
      }
    }

    for (const [artId, plans] of Object.entries(seenInPlans)) {
      if (plans.length <= 1) continue;
      const art = this.allArtifacts[artId];
      const nativePlanId = (art && art.sourceBriefId != null) ? 'plan_' + art.sourceBriefId : plans[0];
      for (let i = 0; i < this.allLinks.length; i++) {
        const lk = this.allLinks[i];
        if (lk.type !== 'contains' || lk.tgt !== artId) continue;
        const parentArt = this.allArtifacts[lk.src];
        if (!parentArt || parentArt.plan === nativePlanId) continue;
        const ghostId = artId + '__ghost__' + parentArt.plan;
        if (!this.allArtifacts[ghostId]) {
          this.allArtifacts[ghostId] = { ...this.allArtifacts[artId], id: ghostId,
            plan: parentArt.plan, isGhost: true, ghostOf: artId,
            ghostParent: lk.src, crossPlan: false, syncedToOtherPlans: false };
        }
        this.allLinks[i] = { type: 'contains', src: lk.src, tgt: ghostId };
        const ghostKey = 'ghost:' + artId + ':' + ghostId;
        if (!linkKeys.has(ghostKey)) {
          linkKeys.add(ghostKey);
          this.allLinks.push({ type: 'ghost', src: artId, tgt: ghostId });
        }
      }
    }

    // Phase 2 ghost expansion
    {
      const linkSnap   = this.allLinks.slice();
      const ghostItems = Object.entries(this.allArtifacts).filter(([, a]) => a.isGhost);
      for (const [ghostId, ghostArt] of ghostItems) {
        const canonId     = ghostArt.ghostOf;
        const ghostPlanId = ghostArt.plan;
        for (const lk of linkSnap) {
          if (ghostArt.type === 'list' && lk.type === 'contains' && lk.src === canonId) {
            const cardArt = this.allArtifacts[lk.tgt];
            if (cardArt && cardArt.type === 'card') {
              const cGhostId = lk.tgt + '__ghost__' + ghostPlanId;
              if (!this.allArtifacts[cGhostId]) {
                this.allArtifacts[cGhostId] = { ...cardArt, id: cGhostId, plan: ghostPlanId,
                  isGhost: true, ghostOf: lk.tgt, ghostParent: ghostId, crossPlan: false };
              }
              const ck = 'contains:' + ghostId + ':' + cGhostId;
              if (!linkKeys.has(ck)) { linkKeys.add(ck); this.allLinks.push({ type: 'contains', src: ghostId, tgt: cGhostId }); }
              const ak = 'ghost:' + lk.tgt + ':' + cGhostId;
              if (!linkKeys.has(ak)) { linkKeys.add(ak); this.allLinks.push({ type: 'ghost', src: lk.tgt, tgt: cGhostId }); }
            }
          }
          if (lk.type === 'pins' && lk.src === canonId) {
            const tGhostId = lk.tgt + '__ghost__' + ghostPlanId;
            if (this.allArtifacts[tGhostId]) {
              const pk = 'pins:' + ghostId + ':' + tGhostId;
              if (!linkKeys.has(pk)) { linkKeys.add(pk); this.allLinks.push({ type: 'pins', src: ghostId, tgt: tGhostId }); }
            }
          }
        }
      }
    }

    this.computeLayout();
    this.buildPlanPills();
    this.buildLayersPanel();
    this.resizeCanvas();
    this.fitViewMain();
    requestAnimationFrame(() => {
      this.resizeCanvas();
      this.fitViewMain();
    });
  }

  // ─── Layout ──────────────────────────────────────────────────────────────────

  private computeTierY(): void {
    const occupied = new Set<string>();
    for (const art of Object.values(this.allArtifacts)) {
      if (!art) continue;
      const cfg = this.cfgFor(art);
      if (cfg) occupied.add(String(cfg.tier));
    }
    const tiers   = ['5', '4.5', '4', '3', '2', '1', '0'];
    // fullH = distance from this tier's Y to the next tier's Y
    // gap between node bottom and next tier = fullH - NODE_H (50)
    const fullH: Record<string, number> = { '5': 140, '4.5': 120, '4': 150, '3': 150, '2': 150, '1': 170, '0': 200 };
    const emptyH  = 40;
    let y = 24;
    const result: Record<string, number> = {};
    for (const tier of tiers) {
      result[tier] = y;
      y += occupied.has(tier) ? fullH[tier] : emptyH;
    }
    result['-1'] = y + 80; // overridden after layout
    this.tierY = result;
  }

  private computeLayout(): void {
    this.computeTierY();
    this.nodePos         = {};
    this.planBounds      = {};
    this.canonicalOf     = {};
    this.primaryVisualOf = {};

    const allChildren: Record<string, string[]> = {};
    for (const lk of this.allLinks) {
      if (lk.type !== 'contains') continue;
      if (!allChildren[lk.src]) allChildren[lk.src] = [];
      if (!allChildren[lk.src].includes(lk.tgt)) allChildren[lk.src].push(lk.tgt);
    }

    let curOffsetX = 100;
    const planIds  = Object.keys(this.allArtifacts).filter(id => this.allArtifacts[id]?.type === 'plan');

    for (const pid of planIds) {
      const w = this.layoutPlan(pid, curOffsetX, allChildren);
      curOffsetX += w + PLAN_GAP;
    }

    // Orphans
    let orphanX = curOffsetX;
    for (const id of Object.keys(this.allArtifacts)) {
      if (this.nodePos[id] || this.primaryVisualOf[id]) continue;
      const art = this.allArtifacts[id];
      if (!art || art.isGhost) continue;
      const cfg = this.cfgFor(art);
      this.nodePos[id] = { x: orphanX, y: cfg ? (this.tierY[String(cfg.tier)] ?? this.tierY['0']) : this.tierY['0'] };
      orphanX += NODE_W + H_GAP;
    }

    // Reposition references now that we know content bottom
    if (Object.keys(this.nodePos).length > 0) {
      const nonRefMaxY = Math.max(...Object.values(this.nodePos)
        .filter((_, i) => {
          const id = Object.keys(this.nodePos)[i];
          const art = this.allArtifacts[this.canonicalOf[id] || id];
          return art && this.resolvedType(art) !== 'reference';
        })
        .map(p => p.y + NODE_H)
        .filter(v => isFinite(v)), this.tierY['0'] + NODE_H);
      this.tierY['-1'] = nonRefMaxY + 80;
      for (const art of Object.values(this.allArtifacts)) {
        if (!art || this.resolvedType(art) !== 'reference') continue;
        if (this.nodePos[art.id]) this.nodePos[art.id].y = this.tierY['-1'];
      }
    }

    // Plan bounding boxes
    for (const pid of planIds) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [vId, pos] of Object.entries(this.nodePos)) {
        const cId = this.canonicalOf[vId] || vId;
        const art = this.allArtifacts[cId];
        if (!art || art.plan !== pid) continue;
        minX = Math.min(minX, pos.x);        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + NODE_W); maxY = Math.max(maxY, pos.y + NODE_H);
      }
      if (isFinite(minX)) {
        this.planBounds[pid] = { x: minX - 14, y: minY - 14, w: maxX - minX + 28, h: maxY - minY + 28 };
      }
    }

    this.computeTierBandBounds();
  }

  private computeTierBandBounds(): void {
    const pad = 16;
    // Initialize from tierY with minimum single-node height
    this.tierBandBounds = {};
    for (const [tier, ty] of Object.entries(this.tierY)) {
      this.tierBandBounds[tier] = { top: ty - pad, bottom: ty + NODE_H + pad };
    }
    // Expand each tier's bounds to contain all nodes actually placed there
    for (const [vId, pos] of Object.entries(this.nodePos)) {
      const canonId = this.canonicalOf[vId] || vId;
      const art = this.allArtifacts[canonId];
      if (!art) continue;
      const cfg = this.cfgFor(art);
      if (!cfg) continue;
      const tier = String(cfg.tier);
      const b = this.tierBandBounds[tier];
      if (!b) continue;
      b.top    = Math.min(b.top,    pos.y - pad);
      b.bottom = Math.max(b.bottom, pos.y + NODE_H + pad);
    }
  }

  private resolvedType(art: ArtEntry): string | null {
    if (!art) return null;
    return TYPE_ALIAS[art.type] || art.type;
  }

  private cfgFor(art: ArtEntry) {
    return TYPE_CONFIG[this.resolvedType(art) ?? ''] || TYPE_CONFIG[art.type] || null;
  }

  private layoutPlan(planId: string, startX: number, allChildren: Record<string, string[]>): number {
    const planCh = allChildren[planId] || [];

    // Classify the plan's direct children by type.
    // Sections handle their own children; unsectioned artifacts are laid out below the plan directly.
    const sectionIds  = planCh.filter(id => this.resolvedType(this.allArtifacts[id]) === 'section');
    const boardIds    = planCh.filter(id => this.resolvedType(this.allArtifacts[id]) === 'board');
    const listIds     = planCh.filter(id => this.resolvedType(this.allArtifacts[id]) === 'list');
    const tier3Direct = planCh.filter(id => ['c2board','timeline','map','whiteboard','cause_effect'].includes(this.resolvedType(this.allArtifacts[id]) ?? ''));
    const tier4Direct = planCh.filter(id => ['presentation','document'].includes(this.resolvedType(this.allArtifacts[id]) ?? ''));

    // BFS for references (they can live at any depth)
    const refIds: string[] = [];
    {
      const seen = new Set<string>(); const queue = [...planCh];
      while (queue.length) {
        const id = queue.shift()!; if (seen.has(id)) continue; seen.add(id);
        const t = this.resolvedType(this.allArtifacts[id]);
        if (!t) continue;
        if (t === 'reference') { refIds.push(id); continue; }
        if (t === 'list' || t === 'section') queue.push(...(allChildren[id] ?? []));
      }
    }

    let curX = startX;

    // Each section lays out its own subtree (boards, visual tools, docs, lists, cards)
    for (const sid of sectionIds) {
      const w = this.layoutSection(sid, curX, allChildren);
      curX += w + H_GAP;
    }

    // Unsectioned list boards
    for (const bid of boardIds) {
      const w = this.layoutBoard(bid, curX, allChildren);
      curX += w + H_GAP;
    }

    // Unsectioned standalone lists
    for (const lid of listIds) {
      const w = this.layoutList(lid, curX, allChildren);
      curX += w + H_GAP;
    }

    // Unsectioned C2 boards (cards need horizontal space reservation)
    for (const cbid of tier3Direct) {
      if (this.resolvedType(this.allArtifacts[cbid]) === 'c2board') {
        const w = this.layoutC2Board(cbid, curX, allChildren);
        if (w > 0) curX += w + H_GAP;
      }
    }

    // Cards that have no list/board parent (e.g. widget-only embeds) — position within plan column
    for (const id of planCh) {
      if (this.resolvedType(this.allArtifacts[id]) === 'card' && !this.nodePos[id]) {
        this.nodePos[id] = { x: curX, y: this.tierY['0'] };
        curX += NODE_W + H_GAP;
      }
    }

    let baseWidth = curX - startX;
    if (baseWidth > H_GAP) baseWidth -= H_GAP;
    if (baseWidth <= 0)    baseWidth  = NODE_W;

    const planCenterX = startX + baseWidth / 2;

    if (tier3Direct.length > 0) {
      const totalW = tier3Direct.length * NODE_W + (tier3Direct.length - 1) * H_GAP;
      let tx = planCenterX - totalW / 2;
      for (const id of tier3Direct) {
        if (!this.nodePos[id]) this.nodePos[id] = { x: tx, y: this.tierY['3'] };
        tx += NODE_W + H_GAP;
      }
    }

    if (tier4Direct.length > 0) {
      const totalW = tier4Direct.length * NODE_W + (tier4Direct.length - 1) * H_GAP;
      let tx = planCenterX - totalW / 2;
      for (const id of tier4Direct) {
        if (!this.nodePos[id]) this.nodePos[id] = { x: tx, y: this.tierY['4'] };
        tx += NODE_W + H_GAP;
      }
    }

    if (refIds.length > 0) {
      const totalW = refIds.length * NODE_W + (refIds.length - 1) * H_GAP;
      let tx = planCenterX - totalW / 2;
      for (const id of refIds) {
        this.nodePos[id] = { x: tx, y: this.tierY['-1'] };
        tx += NODE_W + H_GAP;
      }
    }

    this.nodePos[planId] = { x: planCenterX - NODE_W / 2, y: this.tierY['5'] };
    return baseWidth;
  }

  // Layout a section and everything it contains, mirroring the plan→board→list→card cascade.
  // Boards, lists, visual tools, and output products all land at their normal tiers below the section node.
  private layoutSection(sectionId: string, startX: number, allChildren: Record<string, string[]>): number {
    const kids = allChildren[sectionId] || [];

    const boardKids = kids.filter(id => this.resolvedType(this.allArtifacts[id]) === 'board');
    const listKids  = kids.filter(id => this.resolvedType(this.allArtifacts[id]) === 'list');
    const tier3Kids = kids.filter(id => ['c2board','timeline','map','whiteboard','cause_effect'].includes(this.resolvedType(this.allArtifacts[id]) ?? ''));
    const tier4Kids = kids.filter(id => ['presentation','document'].includes(this.resolvedType(this.allArtifacts[id]) ?? ''));

    let curX = startX;

    for (const bid of boardKids) {
      const w = this.layoutBoard(bid, curX, allChildren);
      curX += w + H_GAP;
    }

    for (const lid of listKids) {
      const w = this.layoutList(lid, curX, allChildren);
      curX += w + H_GAP;
    }

    for (const cbid of tier3Kids) {
      if (this.resolvedType(this.allArtifacts[cbid]) === 'c2board') {
        const w = this.layoutC2Board(cbid, curX, allChildren);
        if (w > 0) curX += w + H_GAP;
      }
    }

    let baseWidth = curX - startX;
    if (baseWidth > H_GAP) baseWidth -= H_GAP;
    if (baseWidth <= 0)    baseWidth  = NODE_W;

    const centerX = startX + baseWidth / 2;

    if (tier3Kids.length > 0) {
      const totalW = tier3Kids.length * NODE_W + (tier3Kids.length - 1) * H_GAP;
      let tx = centerX - totalW / 2;
      for (const id of tier3Kids) {
        if (!this.nodePos[id]) this.nodePos[id] = { x: tx, y: this.tierY['3'] };
        tx += NODE_W + H_GAP;
      }
    }

    if (tier4Kids.length > 0) {
      const totalW = tier4Kids.length * NODE_W + (tier4Kids.length - 1) * H_GAP;
      let tx = centerX - totalW / 2;
      for (const id of tier4Kids) {
        if (!this.nodePos[id]) this.nodePos[id] = { x: tx, y: this.tierY['4'] };
        tx += NODE_W + H_GAP;
      }
    }

    this.nodePos[sectionId] = { x: centerX - NODE_W / 2, y: this.tierY['4.5'] };
    return baseWidth;
  }

  private layoutBoard(boardId: string, startX: number, allChildren: Record<string, string[]>): number {
    const lists = (allChildren[boardId] || []).filter(id => this.allArtifacts[id]?.type === 'list');
    if (lists.length === 0) {
      this.nodePos[boardId] = { x: startX, y: this.tierY['2'] };
      return NODE_W;
    }
    let curX = startX;
    for (const lid of lists) {
      const w = this.layoutList(lid, curX, allChildren);
      curX += w + H_GAP;
    }
    const boardWidth   = curX - startX - H_GAP;
    const boardCenterX = startX + boardWidth / 2;
    this.nodePos[boardId] = { x: boardCenterX - NODE_W / 2, y: this.tierY['2'] };
    return boardWidth;
  }

  private layoutC2Board(c2boardId: string, startX: number, allChildren: Record<string, string[]>): number {
    const units = (allChildren[c2boardId] || []).filter(
      id => this.allArtifacts[id] && this.resolvedType(this.allArtifacts[id]) === 'card'
    );
    if (units.length === 0) return 0;

    const totalCols  = Math.ceil(units.length / CARD_STACK_MAX);
    const colsPerRow = Math.min(totalCols, MAX_COLS_PER_ROW);

    for (let i = 0; i < units.length; i++) {
      const col      = Math.floor(i / CARD_STACK_MAX);
      const row      = i % CARD_STACK_MAX;
      const rowGroup = Math.floor(col / MAX_COLS_PER_ROW);
      const colInRow = col % MAX_COLS_PER_ROW;
      if (!this.nodePos[units[i]] && !this.primaryVisualOf[units[i]]) {
        this.nodePos[units[i]] = {
          x: startX + colInRow * (NODE_W + H_GAP),
          y: this.tierY['0'] + row * V_CARD_STEP + rowGroup * (CARD_STACK_MAX * V_CARD_STEP + CARD_ROW_GAP),
        };
      }
    }

    return colsPerRow * NODE_W + (colsPerRow - 1) * H_GAP;
  }

  private layoutList(listId: string, startX: number, allChildren: Record<string, string[]>): number {
    const cards = (allChildren[listId] || []).filter(id => this.allArtifacts[id]?.type === 'card');

    if (cards.length === 0) {
      this.nodePos[listId] = { x: startX, y: this.tierY['1'] };
      return NODE_W;
    }

    if (this.focusLayout) {
      // Focus mode: place each card at its canonical ID (no virtual ⊕ duplicates).
      // Cards already placed by a previous list are skipped — they act as nexus nodes
      // that multiple lists point to via their original contains links.
      const toPlace = cards.filter(id => !this.nodePos[id]);
      if (toPlace.length > 0) {
        const totalCols  = Math.ceil(toPlace.length / CARD_STACK_MAX);
        const colsPerRow = Math.min(totalCols, MAX_COLS_PER_ROW);
        for (let i = 0; i < toPlace.length; i++) {
          const col      = Math.floor(i / CARD_STACK_MAX);
          const row      = i % CARD_STACK_MAX;
          const rowGroup = Math.floor(col / MAX_COLS_PER_ROW);
          const colInRow = col % MAX_COLS_PER_ROW;
          this.nodePos[toPlace[i]] = {
            x: startX + colInRow * (NODE_W + H_GAP),
            y: this.tierY['0'] + row * V_CARD_STEP + rowGroup * (CARD_STACK_MAX * V_CARD_STEP + CARD_ROW_GAP),
          };
        }
        const listWidth = colsPerRow * NODE_W + (colsPerRow - 1) * H_GAP;
        this.nodePos[listId] = { x: startX + listWidth / 2 - NODE_W / 2, y: this.tierY['1'] };
        return listWidth;
      }
      // All cards already placed by an earlier list — give the list its own node but no width claim
      this.nodePos[listId] = { x: startX, y: this.tierY['1'] };
      return NODE_W;
    }

    // Normal (main canvas) mode: create virtual ⊕ IDs so each card appears under every list it belongs to
    const totalCols  = Math.ceil(cards.length / CARD_STACK_MAX);
    const colsPerRow = Math.min(totalCols, MAX_COLS_PER_ROW);

    for (let i = 0; i < cards.length; i++) {
      const col      = Math.floor(i / CARD_STACK_MAX);
      const row      = i % CARD_STACK_MAX;
      const rowGroup = Math.floor(col / MAX_COLS_PER_ROW);
      const colInRow = col % MAX_COLS_PER_ROW;
      const vId = cards[i] + '⊕' + listId;
      this.nodePos[vId] = {
        x: startX + colInRow * (NODE_W + H_GAP),
        y: this.tierY['0'] + row * V_CARD_STEP + rowGroup * (CARD_STACK_MAX * V_CARD_STEP + CARD_ROW_GAP),
      };
      this.canonicalOf[vId] = cards[i];
      if (!this.primaryVisualOf[cards[i]]) this.primaryVisualOf[cards[i]] = vId;
    }

    const listWidth = colsPerRow * NODE_W + (colsPerRow - 1) * H_GAP;
    this.nodePos[listId] = { x: startX + listWidth / 2 - NODE_W / 2, y: this.tierY['1'] };
    return listWidth;
  }

  private makePosHelpers(positions: Record<string, Pos>) {
    const effPos = (id: string): Pos | null => {
      if (positions[id]) return positions[id];
      const v = this.primaryVisualOf[id];
      if (v && positions[v]) return positions[v];
      return null;
    };
    const containPos = (srcId: string, tgtId: string): Pos | null => {
      const vId = tgtId + '⊕' + srcId;
      if (positions[vId]) return positions[vId];
      return effPos(tgtId);
    };
    return { effPos, containPos };
  }

  // ─── Canvas Sizing ───────────────────────────────────────────────────────────

  private resizeCanvas(): void {
    const w = this.canvasWrap.clientWidth  || window.innerWidth;
    const h = this.canvasWrap.clientHeight || (window.innerHeight - 44);
    this.mainCanvas.width  = w;
    this.mainCanvas.height = h;
    if (this.focusOpen) this.resizeFocusCanvas();
  }

  private resizeFocusCanvas(): void {
    const w = this.focusWrap.clientWidth  || window.innerWidth;
    const h = this.focusWrap.clientHeight || (window.innerHeight - 44);
    this.focusCanvas.width  = w;
    this.focusCanvas.height = h;
  }

  private fitViewMain(): void {
    const r = this.computeFitView(this.mainCanvas, this.nodePos, Object.keys(this.nodePos));
    this.panX = r.panX; this.panY = r.panY; this.scale = r.scale;
    this.renderAll();
  }

  private computeFitView(canvas: HTMLCanvasElement, positions: Record<string, Pos>, ids: string[]) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const p = positions[id];
      if (!p) continue;
      minX = Math.min(minX, p.x);        minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W); maxY = Math.max(maxY, p.y + NODE_H);
    }
    if (!isFinite(minX)) return { panX: 0, panY: 0, scale: 1 };
    const cw  = canvas.width  || 800;
    const ch  = canvas.height || 600;
    const pad = 60;
    const s   = Math.min(cw / (maxX - minX + pad * 2), ch / (maxY - minY + pad * 2), 1.0);
    const px  = (cw - (maxX - minX) * s) / 2 - minX * s;
    const py  = (ch - (maxY - minY) * s) / 2 - minY * s;
    return { panX: px, panY: py, scale: s };
  }

  // ─── Plan Pills ──────────────────────────────────────────────────────────────

  private buildPlanPills(): void {
    this.planPillsEl.innerHTML = '';
    for (const [, meta] of Object.entries(this.planMeta)) {
      const cfg  = TYPE_CONFIG.plan;
      const pill = document.createElement('div');
      pill.className       = 'am-plan-pill';
      pill.title           = meta.title;
      pill.textContent     = meta.title;
      pill.style.color       = cfg.color;
      pill.style.borderColor = cfg.color + '44';
      pill.style.background  = cfg.bg;
      this.planPillsEl.appendChild(pill);
    }
  }

  // ─── BFS ─────────────────────────────────────────────────────────────────────

  // Full upward BFS used for Impact mode.
  // Finds everything that would be affected if this artifact changes (flows UP only).
  private bfsImpact(startId: string): Map<string, number> {
    const visited = new Map([[startId, 0]]);
    let frontier  = [startId];
    let d = 1;
    while (frontier.length && d <= 50) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const lk of this.allLinks) {
          if (lk.type === 'contains' && lk.tgt === cur && !visited.has(lk.src)) {
            visited.set(lk.src, d); next.push(lk.src);
          }
          if (lk.type === 'pins' && lk.tgt === cur && !visited.has(lk.src)) {
            visited.set(lk.src, d); next.push(lk.src);
          }
          // Ghost (sync): change to original propagates forward to all synced copies
          if (lk.type === 'ghost' && lk.src === cur && !visited.has(lk.tgt)) {
            visited.set(lk.tgt, d); next.push(lk.tgt);
          }
          if (lk.type === 'sourced_from' && lk.tgt === cur && !visited.has(lk.src)) {
            visited.set(lk.src, d); next.push(lk.src);
          }
        }
      }
      frontier = next;
      d++;
    }
    return visited;
  }

  // Full bidirectional BFS used for normal selection.
  // Walks all the way UP (every path to plan) and all the way DOWN (every card in the artifact).
  private bfsBidirectional(startId: string): Map<string, number> {
    const visited = new Map([[startId, 0]]);

    // Phase 1 — go up through contains/pins/ghost/sourced_from until no new parents
    let frontier = [startId];
    let d = 1;
    while (frontier.length && d <= 50) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const lk of this.allLinks) {
          if (lk.type === 'contains' && lk.tgt === cur && !visited.has(lk.src)) {
            visited.set(lk.src, d); next.push(lk.src);
          }
          if (lk.type === 'pins' && lk.tgt === cur && !visited.has(lk.src)) {
            visited.set(lk.src, d); next.push(lk.src);
          }
          if (lk.type === 'ghost') {
            const other = lk.src === cur ? lk.tgt : lk.tgt === cur ? lk.src : null;
            if (other && !visited.has(other)) { visited.set(other, d); next.push(other); }
          }
          if (lk.type === 'sourced_from' && lk.tgt === cur && !visited.has(lk.src)) {
            visited.set(lk.src, d); next.push(lk.src);
          }
        }
      }
      frontier = next;
      d++;
    }

    // Phase 2 — go down through contains/pins from the start node to all descendants
    const downVisited = new Map([[startId, 0]]);
    frontier = [startId];
    d = 1;
    while (frontier.length && d <= 50) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const lk of this.allLinks) {
          if (lk.type === 'contains' && lk.src === cur && !downVisited.has(lk.tgt)) {
            downVisited.set(lk.tgt, d); next.push(lk.tgt);
          }
          if (lk.type === 'pins' && lk.src === cur && !downVisited.has(lk.tgt)) {
            downVisited.set(lk.tgt, d); next.push(lk.tgt);
          }
        }
      }
      frontier = next;
      d++;
    }

    // Merge downward nodes (use the upward depth if already found going up)
    for (const [id, dd] of downVisited) {
      if (!visited.has(id)) visited.set(id, dd);
    }

    return visited;
  }

  private getHighlightedNodes(): Map<string, number> | null {
    if (!this.selectedId) return null;
    if (this.modeImpact) return this.bfsImpact(this.selectedId);
    return this.bfsBidirectional(this.selectedId);
  }

  // ─── Rendering — Main ────────────────────────────────────────────────────────

  private drawTierBands(ctx: CanvasRenderingContext2D): void {
    const BX = -1000, BW = 14000;
    // Alternating: each occupied tier gets a distinct semantic tint; adjacent tiers clearly differ
    const BAND_BG: Record<string, string> = {
      '5':   'rgba(115,87,255,0.07)',  // purple  — Plan
      '4.5': 'rgba(79,70,229,0.08)',   // indigo  — Sections
      '4':   'rgba(220,53,69,0.05)',   // red     — Output Products
      '3':   'rgba(25,135,84,0.07)',   // green   — Visual Tools
      '2':   'rgba(49,112,170,0.08)',  // blue    — List Boards
      '1':   'rgba(25,135,84,0.05)',   // green   — Lists
      '0':   'rgba(91,104,123,0.06)',  // slate   — Cards
      '-1':  'rgba(49,112,170,0.07)', // blue    — Refs
    };
    const ACCENT: Record<string, string> = {
      '5': '#7357ff', '4.5': '#4f46e5', '4': '#dc3545', '3': '#198754',
      '2': '#3170aa', '1': '#198754', '0': '#5b687b', '-1': '#3170aa',
    };
    const occupied = new Set<string>();
    for (const art of Object.values(this.allArtifacts)) {
      if (!art) continue;
      const cfg = this.cfgFor(art);
      if (cfg) occupied.add(String(cfg.tier));
    }
    for (const tier of ['5', '4.5', '4', '3', '2', '1', '0', '-1']) {
      const b = this.tierBandBounds[tier];
      if (!b) continue;
      const bandH = b.bottom - b.top;
      if (occupied.has(tier)) {
        ctx.fillStyle = BAND_BG[tier] ?? 'rgba(0,0,0,0.04)';
        ctx.fillRect(BX, b.top, BW, bandH);
        ctx.fillStyle = (ACCENT[tier] ?? '#5b687b') + '30';
        ctx.fillRect(BX, b.top, 4, bandH);
      } else {
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = (ACCENT[tier] ?? '#5b687b') + '50';
        ctx.lineWidth = 1;
        ctx.strokeRect(BX + 1, b.top + 1, BW - 2, bandH - 2);
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }

  private drawTierLabels(ctx: CanvasRenderingContext2D): void {
    const LABELS: Record<string, string> = {
      '5': 'PLAN', '4.5': 'SECTIONS', '4': 'OUTPUT PRODUCTS', '3': 'VISUAL TOOLS',
      '2': 'LIST BOARDS', '1': 'LISTS', '0': 'CARDS', '-1': 'UPLOADED REFS',
    };
    const COLORS: Record<string, string> = {
      '5': '#7357ff', '4.5': '#4f46e5', '4': '#dc3545', '3': '#198754',
      '2': '#3170aa', '1': '#198754', '0': '#5b687b', '-1': '#3170aa',
    };
    const occupied = new Set<string>();
    for (const art of Object.values(this.allArtifacts)) {
      if (!art) continue;
      const cfg = this.cfgFor(art);
      if (cfg) occupied.add(String(cfg.tier));
    }
    const FONT = '600 11px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    ctx.save();
    ctx.font = FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const tier of ['5', '4.5', '4', '3', '2', '1', '0', '-1']) {
      const b = this.tierBandBounds[tier];
      if (!b) continue;
      const screenTop    = b.top    * this.scale + this.panY;
      const screenBottom = b.bottom * this.scale + this.panY;
      if (screenBottom < 0 || screenTop > ctx.canvas.height) continue;
      const screenMidY = (screenTop + screenBottom) / 2;
      const label  = LABELS[tier] ?? tier;
      const color  = COLORS[tier] ?? '#5b687b';
      const isOcc  = occupied.has(tier);
      const textW  = ctx.measureText(label).width;
      // Pill background for readability
      ctx.fillStyle = isOcc ? 'rgba(248,249,250,0.82)' : 'rgba(248,249,250,0.6)';
      const px = 8, py = screenMidY - 9, pw = textW + 12, ph = 18;
      ctx.beginPath(); this.rrect(ctx, px, py, pw, ph, 4); ctx.fill();
      // Label text
      ctx.fillStyle = isOcc ? color + 'cc' : '#c1cbd7';
      ctx.fillText(label, px + 6, screenMidY);
    }
    ctx.restore();
  }

  private drawDotGrid(ctx: CanvasRenderingContext2D, w: number, h: number, panX: number, panY: number, scale: number): void {
    const spacing = Math.max(20, 30 * scale);
    if (spacing < 8) return;
    const startX = ((panX % spacing) + spacing) % spacing;
    const startY = ((panY % spacing) + spacing) % spacing;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    for (let x = startX; x < w; x += spacing) {
      for (let y = startY; y < h; y += spacing) {
        ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  private renderAll(): void {
    this.resizeCanvas();
    this.mCtx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
    this.drawDotGrid(this.mCtx, this.mainCanvas.width, this.mainCanvas.height, this.panX, this.panY, this.scale);
    this.mCtx.save();
    this.mCtx.translate(this.panX, this.panY);
    this.mCtx.scale(this.scale, this.scale);
    this.drawScene(
      this.mCtx, this.nodePos, this.planBounds, this.allArtifacts, this.allLinks,
      this.selectedId, this.getHighlightedNodes(), this.modeImpact
    );
    this.mCtx.restore();
    this.drawTierLabels(this.mCtx);
  }

  private drawScene(
    ctx: CanvasRenderingContext2D,
    positions: Record<string, Pos>,
    pBounds: Record<string, PlanBounds>,
    artifacts: Record<string, ArtEntry>,
    links: LinkEntry[],
    selId: string | null,
    highlighted: Map<string, number> | null,
    showDepthBadge: boolean,
  ): void {
    const hasSel = selId !== null;
    const { effPos, containPos } = this.makePosHelpers(positions);

    // Swim lane backgrounds
    this.drawTierBands(ctx);

    // Plan background regions
    for (const [, bounds] of Object.entries(pBounds)) {
      const col = TYPE_CONFIG.plan.color;
      ctx.save();
      ctx.globalAlpha = 0.05;
      ctx.fillStyle   = col;
      ctx.beginPath(); this.rrect(ctx, bounds.x, bounds.y, bounds.w, bounds.h, 12); ctx.fill();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }

    // Uploaded references shaded band
    const refNodes = Object.entries(artifacts).filter(([, a]) => this.resolvedType(a) === 'reference' && positions[a.id]);
    if (refNodes.length > 0) {
      const xs = refNodes.map(([, a]) => positions[a.id].x);
      const rx1 = Math.min(...xs) - 20, rx2 = Math.max(...xs) + NODE_W + 20;
      const ry  = this.tierY['-1'] - 14, rh = NODE_H + 28;
      ctx.save();
      ctx.globalAlpha = 0.08; ctx.fillStyle = '#3170aa';
      ctx.beginPath(); this.rrect(ctx, rx1, ry, rx2 - rx1, rh, 8); ctx.fill();
      ctx.globalAlpha = 0.22; ctx.strokeStyle = '#3170aa'; ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 0.5; ctx.fillStyle = '#3170aa';
      ctx.font = '700 8px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('UPLOADED REFERENCES', rx1 + 8, ry + 4);
      ctx.restore();
    }

    const edgeOrder = ['sourced_from', 'pins', 'contains'];
    for (const lt of edgeOrder) {
      for (const lk of links) {
        if (lk.type !== lt) continue;
        if (this.hiddenTiers.size > 0) {
          const sA = artifacts[lk.src]; const tA = artifacts[lk.tgt];
          const sC = sA ? this.cfgFor(sA) : null; const tC = tA ? this.cfgFor(tA) : null;
          if ((sC && this.hiddenTiers.has(String(sC.tier))) || (tC && this.hiddenTiers.has(String(tC.tier)))) continue;
        }
        let sp, tp;
        if (lt === 'contains') {
          sp = effPos(lk.src);
          tp = containPos(lk.src, lk.tgt);
        } else {
          sp = effPos(lk.src);
          tp = effPos(lk.tgt);
        }
        if (!sp || !tp) continue;
        const lcfg = LINK_CONFIG[lk.type] || LINK_CONFIG.contains;
        let op = lt === 'contains' ? 0.4 : 0.45;
        if (hasSel) {
          const shC = highlighted && highlighted.has(lk.src);
          const thC = highlighted && highlighted.has(lk.tgt);
          op = (shC && thC) ? 0.9 : 0.04;
        }
        ctx.save(); ctx.globalAlpha = op;
        this.drawEdge(ctx, sp, tp, lcfg, lt);
        ctx.restore();
      }
    }

    // Ghost arcs — always visible; brighten when the source is in the highlighted chain
    for (const lk of links) {
      if (lk.type !== 'ghost') continue;
      if (this.hiddenTiers.size > 0) {
        const sA = artifacts[lk.src]; const tA = artifacts[lk.tgt];
        const sC = sA ? this.cfgFor(sA) : null; const tC = tA ? this.cfgFor(tA) : null;
        if ((sC && this.hiddenTiers.has(String(sC.tier))) || (tC && this.hiddenTiers.has(String(tC.tier)))) continue;
      }
      const ghostArt = artifacts[lk.tgt];
      const arcTgtId = ghostArt?.ghostParent || lk.tgt;
      const sp = effPos(lk.src);
      const tp = effPos(arcTgtId);
      if (!sp || !tp) continue;
      let op: number;
      if (!hasSel) op = 0.25;
      else if (highlighted && highlighted.has(lk.src)) op = 0.75;
      else op = 0.06;
      ctx.save(); ctx.globalAlpha = op;
      this.drawEdge(ctx, sp, tp, LINK_CONFIG.ghost, 'ghost');
      ctx.restore();
    }

    // Depth-color palettes matching the reference implementation
    const IMPACT_PALETTE    = ['#3170aa', '#dc3545', '#fd7e14', '#ffc107'];
    const DEEPDIVE_PALETTE  = ['#198754', '#17a2b8', '#ffc107', '#6c757d'];

    // Nodes
    for (const [vId, pos] of Object.entries(positions)) {
      const canonId = this.canonicalOf[vId] || vId;
      const art = artifacts[canonId];
      if (!art) continue;
      const cfg = this.cfgFor(art);
      if (!cfg) continue;
      if (this.hiddenTiers.size > 0 && this.hiddenTiers.has(String(cfg.tier))) continue;
      let op = 1;
      if (hasSel) {
        let isHl = highlighted ? highlighted.has(canonId) : false;
        if (isHl && vId !== canonId) {
          // Virtual card node (format: "cardId⊕listId"): only highlight the instance
          // whose parent list is also in the chain — suppresses the same card appearing
          // highlighted in lists that aren't part of the selected chain.
          const sep = vId.indexOf('⊕');
          if (sep >= 0) {
            const parentListId = vId.slice(sep + 1);
            isHl = highlighted ? highlighted.has(parentListId) : false;
          }
        }
        if (!isHl) op = 0.06;
      }
      const depth   = highlighted ? (highlighted.get(canonId) ?? null) : null;
      const isSel   = (canonId === selId);
      let hlColor: string | null = null;
      if (showDepthBadge && depth !== null) {
        const palette = this.modeImpact ? IMPACT_PALETTE : DEEPDIVE_PALETTE;
        hlColor = palette[Math.min(depth, palette.length - 1)];
      }
      this.drawNode(ctx, pos.x, pos.y, art, cfg, isSel, op, depth, showDepthBadge, hlColor);
    }
  }

  private drawEdge(
    ctx: CanvasRenderingContext2D,
    src: Pos, tgt: Pos,
    lcfg: { color: string; dash: number[] },
    linkType: string,
  ): void {
    ctx.strokeStyle = lcfg.color;
    ctx.lineWidth   = linkType === 'contains' ? 1.5 : 1;
    if (lcfg.dash && lcfg.dash.length) ctx.setLineDash(lcfg.dash); else ctx.setLineDash([]);

    const dy = (tgt.y + NODE_H / 2) - (src.y + NODE_H / 2);
    // Use top/bottom anchors when nodes are on different tier rows;
    // use left/right anchors only when they are roughly parallel (same row).
    const useVertical = Math.abs(dy) > NODE_H * 0.75;

    if (linkType === 'contains') {
      // Contains always uses vertical: child top-center → parent bottom-center
      // Arrowhead at parent bottom (arrow enters parent, showing containment)
      const sx = tgt.x + NODE_W / 2;
      const sy = tgt.y;
      const tx = src.x + NODE_W / 2;
      const ty = src.y + NODE_H;
      const cp = Math.max((sy - ty) * 0.4, 20);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx, sy - cp, tx, ty + cp, tx, ty);
      ctx.stroke(); ctx.setLineDash([]);
      this.drawArrow(ctx, tx, ty, tx, ty + cp * 0.5, lcfg.color, 6);
    } else if (useVertical && dy >= 0) {
      // src is above tgt: exit src bottom-center, enter tgt top-center
      const sx = src.x + NODE_W / 2;
      const sy = src.y + NODE_H;
      const tx = tgt.x + NODE_W / 2;
      const ty = tgt.y;
      const cp = Math.max((ty - sy) * 0.4, 20);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx, sy + cp, tx, ty - cp, tx, ty);
      ctx.stroke(); ctx.setLineDash([]);
      this.drawArrow(ctx, tx, ty, tx, ty - cp * 0.5, lcfg.color, 6);
    } else if (useVertical && dy < 0) {
      // src is below tgt: exit src top-center, enter tgt bottom-center
      const sx = src.x + NODE_W / 2;
      const sy = src.y;
      const tx = tgt.x + NODE_W / 2;
      const ty = tgt.y + NODE_H;
      const cp = Math.max((sy - ty) * 0.4, 20);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx, sy - cp, tx, ty + cp, tx, ty);
      ctx.stroke(); ctx.setLineDash([]);
      this.drawArrow(ctx, tx, ty, tx, ty + cp * 0.5, lcfg.color, 6);
    } else {
      // Parallel (same tier row): exit left/right, enter right/left
      const srcCX = src.x + NODE_W / 2;
      const tgtCX = tgt.x + NODE_W / 2;
      let sx: number, tx: number;
      if (srcCX <= tgtCX) {
        sx = src.x + NODE_W; tx = tgt.x;
      } else {
        sx = src.x;          tx = tgt.x + NODE_W;
      }
      const sy = src.y + NODE_H / 2;
      const ty = tgt.y + NODE_H / 2;
      const mx = (sx + tx) / 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(mx, sy, mx, ty, tx, ty);
      ctx.stroke(); ctx.setLineDash([]);
      this.drawArrow(ctx, tx, ty, mx + (tx - mx) * 0.4, ty, lcfg.color, 6);
    }
  }

  private drawArrow(
    ctx: CanvasRenderingContext2D,
    tipX: number, tipY: number, fromX: number, fromY: number,
    color: string, size: number,
  ): void {
    const angle = Math.atan2(tipY - fromY, tipX - fromX), sp = Math.PI / 6;
    ctx.save(); ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - size * Math.cos(angle - sp), tipY - size * Math.sin(angle - sp));
    ctx.lineTo(tipX - size * Math.cos(angle + sp), tipY - size * Math.sin(angle + sp));
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  private drawNode(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    art: ArtEntry,
    cfg: { color: string; bg: string; label: string },
    isSelected: boolean,
    opacity: number,
    depth: number | null,
    showDepthBadge: boolean,
    hlColor: string | null = null,
  ): void {
    const isGhost = !!art.isGhost;
    const isOutgoingSync = !isGhost && !!art.syncedToOtherPlans;
    ctx.save(); ctx.globalAlpha = opacity;
    const w = NODE_W, h = NODE_H;

    // Background + shadow
    ctx.shadowColor = 'rgba(0,0,0,0.07)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = cfg.bg;
    ctx.beginPath(); this.rrect(ctx, x, y, w, h, 5); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

    // Border: ghost = purple dotted; depth highlight = mode color; normal = type color
    if (isGhost) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#7357ff';
      ctx.lineWidth   = 1.5;
    } else if (hlColor && depth !== null) {
      ctx.strokeStyle = hlColor;
      ctx.lineWidth   = isSelected ? 2.5 : 2;
    } else {
      ctx.strokeStyle = isSelected ? cfg.color : cfg.color + '55';
      ctx.lineWidth   = isSelected ? 2 : 1;
    }
    ctx.beginPath(); this.rrect(ctx, x, y, w, h, 5);
    ctx.stroke(); ctx.setLineDash([]);

    // Left color bar (clipped)
    ctx.save();
    ctx.beginPath(); this.rrect(ctx, x, y, w, h, 5); ctx.clip();
    ctx.fillStyle = isGhost ? '#7357ff' : cfg.color;
    ctx.fillRect(x, y, 4, h);
    ctx.restore();

    // Type label
    const typeColor = isGhost ? '#7357ff' : cfg.color;
    ctx.fillStyle    = typeColor + 'cc';
    ctx.font         = '9px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign    = 'left'; ctx.textBaseline = 'top';
    ctx.fillText((isGhost ? '↗ ' : '') + cfg.label.toUpperCase(), x + 10, y + 7);

    // Artifact label
    ctx.fillStyle    = isGhost ? '#5b687b' : '#212529';
    ctx.font         = '600 11px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.truncText(ctx, art.label || art.id, w - 16), x + 10, y + 33);

    // Outgoing sync badge (top-right) — indicates this card is synced INTO other plans
    if (isOutgoingSync) {
      const badgeW = 22, badgeH = 11;
      const bx = x + w - badgeW - 4, by = y + 4;
      ctx.fillStyle = '#edfaf3';
      ctx.beginPath(); this.rrect(ctx, bx, by, badgeW, badgeH, 3); ctx.fill();
      ctx.strokeStyle = '#19875466'; ctx.lineWidth = 1;
      ctx.beginPath(); this.rrect(ctx, bx, by, badgeW, badgeH, 3); ctx.stroke();
      ctx.fillStyle = '#198754';
      ctx.font = '700 8px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('↗S', bx + badgeW / 2, by + badgeH / 2);
    }

    // D-badge (bottom-left, not on ghosts)
    if (!isGhost && showDepthBadge && depth !== null && depth !== undefined && depth > 0) {
      const bd = Math.min(depth, 3);
      const bgC = ['', '#e8f1fa', '#fef8e8', '#fef3ea'][bd];
      const txC = ['', '#3170aa', '#9a6700', '#bc4c00'][bd];
      ctx.fillStyle = bgC;
      ctx.beginPath(); this.rrect(ctx, x + 7, y + h - 14, 20, 11, 3); ctx.fill();
      ctx.fillStyle    = txC;
      ctx.font         = '700 8px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign    = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('D' + bd, x + 17, y + h - 8);
    }

    ctx.restore();
  }

  private rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    if ((ctx as any).roundRect) { (ctx as any).roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private truncText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
    }
    return text.slice(0, lo) + '…';
  }

  // ─── Tier Labels ─────────────────────────────────────────────────────────────

  private updateTierLabels(): void {
    for (const [tier, ty] of Object.entries(this.tierY)) {
      const elId = tier === '-1' ? 'am-tl-ref' : 'am-tl-' + tier;
      const el   = this.container.querySelector<HTMLElement>(`#${elId}`);
      if (!el) continue;
      const screenY = (ty + NODE_H / 2) * this.scale + this.panY;
      el.style.top  = screenY - 12 + 'px';
    }
  }

  // ─── Sidebar ─────────────────────────────────────────────────────────────────

  private updateSidebar(): void {
    if (!this.selectedId || !this.allArtifacts[this.selectedId]) {
      this.sidebar.classList.remove('open'); return;
    }
    this.sidebar.classList.add('open');

    const art = this.allArtifacts[this.selectedId];
    const cfg = TYPE_CONFIG[art.type] || { color: '#8b949e', bg: '#f8f9fa', label: art.type };
    const resolvedCfg = TYPE_CONFIG[this.resolvedType(art) ?? ''] || cfg;

    this.sbTypeBadge.textContent       = resolvedCfg.label;
    this.sbTypeBadge.style.color       = resolvedCfg.color;
    this.sbTypeBadge.style.borderColor = resolvedCfg.color + '66';
    this.sbTypeBadge.style.background  = resolvedCfg.bg || '#f8f9fa';
    this.sbTitle.textContent = art.label || art.id;

    const pm = this.planMeta[art.plan];
    this.sbPlan.textContent = pm ? 'Plan: ' + pm.title : (art.plan ?? '');

    // Action buttons
    this.sbActions.innerHTML = '';
    const focusBtn = document.createElement('button');
    focusBtn.className = 'am-sb-action';
    focusBtn.textContent = '⬡ Focus view';
    focusBtn.onclick = () => this.openFocus();
    this.sbActions.appendChild(focusBtn);

    this.sbConnections.innerHTML = '';
    const highlighted = this.getHighlightedNodes();

    if (this.modeImpact) {
      this.renderImpactSidebar(highlighted);
    } else {
      this.renderNormalSidebar();
    }
  }

  private renderNormalSidebar(): void {
    const selId = this.selectedId!;
    const inbound      = this.allLinks.filter(lk => lk.tgt === selId && this.allArtifacts[lk.src] && lk.type !== 'sourced_from');
    const outbound     = this.allLinks.filter(lk => lk.src === selId && this.allArtifacts[lk.tgt] && lk.type !== 'sourced_from');
    const sourcedFrom  = this.allLinks.filter(lk => lk.type === 'sourced_from' && lk.tgt === selId && this.allArtifacts[lk.src]);
    const sourcedCards = this.allLinks.filter(lk => lk.type === 'sourced_from' && lk.src === selId && this.allArtifacts[lk.tgt]);

    if (sourcedFrom.length) {
      this.addSbSection('SOURCE DOCUMENT');
      for (const lk of sourcedFrom) this.addSbItem(lk.src, 'sourced_from', null);
    }
    if (inbound.length) {
      this.addSbSection('CONTAINED IN / PINNED BY');
      for (const lk of inbound) this.addSbItem(lk.src, lk.type, null);
    }
    if (outbound.length) {
      this.addSbSection('CONTAINS / PINS TO');
      for (const lk of outbound) this.addSbItem(lk.tgt, lk.type, null);
    }
    if (sourcedCards.length) {
      this.addSbSection('CARDS FROM THIS REFERENCE');
      for (const lk of sourcedCards) this.addSbItem(lk.tgt, 'sourced_from', null);
    }

    // Outgoing sync info in sidebar
    const art = this.allArtifacts[selId];
    if (art?.syncedToOtherPlans) {
      this.addSbSection('SYNCED TO OTHER PLANS');
      const planCount = art.syncedPlanBriefIds?.length ?? 0;
      const el = document.createElement('div');
      el.className = 'am-sb-section-title';
      el.style.color = '#34d399';
      el.style.fontWeight = '600';
      el.textContent = `↗ Live in ${planCount} other plan${planCount !== 1 ? 's' : ''}`;
      this.sbConnections.appendChild(el);
    }

    if (!inbound.length && !outbound.length && !sourcedFrom.length && !sourcedCards.length && !art?.syncedToOtherPlans) {
      this.addSbSection('NO CONNECTIONS');
    }
  }

  private renderImpactSidebar(highlighted: Map<string, number> | null): void {
    if (!highlighted) return;
    const d1: string[] = [], d2: string[] = [], d3: string[] = [];
    for (const [id, depth] of highlighted) {
      if (id === this.selectedId) continue;
      if (depth === 1) d1.push(id);
      else if (depth === 2) d2.push(id);
      else d3.push(id);
    }
    const l1 = 'DIRECT IMPACT (D1)';
    const l2 = '2ND ORDER (D2)';
    const l3 = '3RD ORDER (D3)';
    if (d1.length) { this.addSbSection(l1); for (const id of d1) this.addSbItem(id, null, 1); }
    if (d2.length) { this.addSbSection(l2); for (const id of d2) this.addSbItem(id, null, 2); }
    if (d3.length) { this.addSbSection(l3); for (const id of d3) this.addSbItem(id, null, 3); }
    if (!d1.length && !d2.length && !d3.length) this.addSbSection('NO CONNECTIONS FOUND');
  }

  private addSbSection(title: string): void {
    const el = document.createElement('div');
    el.className = 'am-sb-section-title'; el.textContent = title;
    this.sbConnections.appendChild(el);
  }

  private panToNode(id: string): void {
    if (this.focusOpen) {
      const pos = this.focusNodePos[this.focusPrimaryVisualOf[id] || id];
      if (!pos) return;
      this.fPanX = this.focusCanvas.width  / 2 - (pos.x + NODE_W / 2) * this.fScale;
      this.fPanY = this.focusCanvas.height / 2 - (pos.y + NODE_H / 2) * this.fScale;
      this.renderFocus();
    } else {
      const pos = this.nodePos[this.primaryVisualOf[id] || id];
      if (!pos) return;
      this.panX = this.mainCanvas.width  / 2 - (pos.x + NODE_W / 2) * this.scale;
      this.panY = this.mainCanvas.height / 2 - (pos.y + NODE_H / 2) * this.scale;
      this.renderAll();
    }
  }

  private addSbItem(id: string, linkType: string | null, depth: number | null): void {
    const art = this.allArtifacts[id]; if (!art) return;
    const cfg = TYPE_CONFIG[this.resolvedType(art) ?? ''] || TYPE_CONFIG[art.type] || { color: '#8b949e' };

    const item = document.createElement('div');
    item.className = 'am-sb-item';
    item.onclick   = () => { this.selectNode(id); this.panToNode(id); };

    const dot = document.createElement('div');
    dot.className = 'am-sb-item-dot'; dot.style.background = cfg.color;
    item.appendChild(dot);

    const lbl = document.createElement('div');
    lbl.className = 'am-sb-item-label'; lbl.title = art.label; lbl.textContent = art.label || id;
    item.appendChild(lbl);

    if (depth != null) {
      const badge = document.createElement('div');
      badge.className   = 'am-sb-badge d' + Math.min(depth, 3);
      badge.textContent = 'D' + Math.min(depth, 3);
      item.appendChild(badge);
    } else if (linkType) {
      const badge = document.createElement('div');
      badge.className = 'am-sb-badge'; badge.textContent = linkType;
      item.appendChild(badge);
    }

    this.sbConnections.appendChild(item);
  }

  // ─── Selection & Hit Testing ─────────────────────────────────────────────────

  private selectNode(id: string): void {
    this.selectedId        = id;
    this.btnFocus.disabled = false;
    this.updateSidebar(); this.renderAll();
    if (this.focusOpen) this.renderFocus();
  }

  private clearSelection(): void {
    this.selectedId        = null;
    this.btnFocus.disabled = true;
    this.sidebar.classList.remove('open');
    this.renderAll();
  }

  private hitTest(
    cx: number, cy: number,
    positions: Record<string, Pos>,
    px: number, py: number, sc: number,
    overrideCanonicalOf?: Record<string, string>,
  ): string | null {
    const wx = (cx - px) / sc, wy = (cy - py) / sc;
    const canon = overrideCanonicalOf ?? this.canonicalOf;
    const ids = Object.keys(positions);
    for (let i = ids.length - 1; i >= 0; i--) {
      const p = positions[ids[i]]; if (!p) continue;
      if (wx >= p.x && wx <= p.x + NODE_W && wy >= p.y && wy <= p.y + NODE_H) {
        return canon[ids[i]] || ids[i];
      }
    }
    return null;
  }

  // ─── Focus Overlay ───────────────────────────────────────────────────────────

  private computeFocusTierY(nodeIds: string[]): Record<string, number> {
    const occupied = new Set<string>();
    for (const id of nodeIds) {
      const cfg = this.cfgFor(this.allArtifacts[id]);
      if (cfg) occupied.add(String(cfg.tier));
    }
    const tiers  = ['5', '4.5', '4', '3', '2', '1', '0'];
    const fullH: Record<string, number> = { '5': 140, '4.5': 120, '4': 150, '3': 150, '2': 150, '1': 170, '0': 200 };
    const emptyH = 36;
    let y = 24;
    const result: Record<string, number> = {};
    for (const tier of tiers) {
      result[tier] = y;
      y += occupied.has(tier) ? fullH[tier] : emptyH;
    }
    result['-1'] = y + 80;
    return result;
  }

  private openFocus(): void {
    if (!this.selectedId) return;
    this.focusOpen = true;

    // Use the same highlighted set as the current mode (bidirectional or impact)
    const highlighted = this.getHighlightedNodes() ?? new Map([[this.selectedId, 0]]);
    this.focusNodeIds = [...highlighted.keys()].filter(id => !!this.allArtifacts[id]);

    this.buildFocusLayout();
    this.focusTitleEl.textContent = this.allArtifacts[this.selectedId]?.label || this.selectedId;
    this.focusOverlay.classList.add('visible');

    this.resizeFocusCanvas();
    const r = this.computeFitView(this.focusCanvas, this.focusNodePos, Object.keys(this.focusNodePos));
    this.fPanX = r.panX; this.fPanY = r.panY; this.fScale = r.scale;
    this.renderFocus();
  }

  private closeFocus(): void {
    this.focusOpen = false;
    this.focusOverlay.classList.remove('visible');
  }

  private buildFocusLayout(): void {
    this.focusNodePos         = {};
    this.focusPlanBounds      = {};
    this.focusCanonicalOf     = {};
    this.focusPrimaryVisualOf = {};

    const focusSet = new Set(this.focusNodeIds);

    // Build allChildren restricted to focus set so the layout only places focused nodes.
    const allChildren: Record<string, string[]> = {};
    for (const lk of this.allLinks) {
      if (lk.type !== 'contains') continue;
      if (!focusSet.has(lk.src) || !focusSet.has(lk.tgt)) continue;
      if (!allChildren[lk.src]) allChildren[lk.src] = [];
      if (!allChildren[lk.src].includes(lk.tgt)) allChildren[lk.src].push(lk.tgt);
    }

    // Compact tier Y — skip tiers that have no focused nodes
    const focusTierY = this.computeFocusTierY(this.focusNodeIds);

    // Save main-canvas layout state and swap in fresh containers for the focus layout pass
    const savedTierY          = this.tierY;
    const savedNodePos        = this.nodePos;
    const savedCanonicalOf    = this.canonicalOf;
    const savedPrimaryVisualOf = this.primaryVisualOf;

    this.tierY          = focusTierY;
    this.nodePos        = {};
    this.canonicalOf    = {};
    this.primaryVisualOf = {};
    this.focusLayout    = true;

    // Run the same layout algorithms, scoped to focused nodes
    const planIds = this.focusNodeIds.filter(id => this.allArtifacts[id]?.type === 'plan');
    let curX = 60;
    for (const pid of planIds) {
      const w = this.layoutPlan(pid, curX, allChildren);
      curX += w + PLAN_GAP;
    }

    // Orphans — focused nodes not reachable from a plan via contains in this focus set
    // (e.g. maps/presentations connected only via pins). Center them within the existing
    // layout bounds at their correct tier Y rather than appending them far to the right.
    {
      const orphansByTier: Record<string, string[]> = {};
      for (const id of this.focusNodeIds) {
        if (this.nodePos[id] || this.primaryVisualOf[id]) continue;
        const art = this.allArtifacts[id];
        if (!art) continue;
        const cfg = this.cfgFor(art);
        const tier = cfg ? String(cfg.tier) : '0';
        if (!orphansByTier[tier]) orphansByTier[tier] = [];
        orphansByTier[tier].push(id);
      }
      if (Object.keys(orphansByTier).length > 0) {
        let minX = Infinity, maxX = -Infinity;
        for (const pos of Object.values(this.nodePos)) {
          minX = Math.min(minX, pos.x);
          maxX = Math.max(maxX, pos.x + NODE_W);
        }
        const centerX = isFinite(minX) ? (minX + maxX) / 2 : 60 + NODE_W / 2;
        for (const [tier, ids] of Object.entries(orphansByTier)) {
          const totalW = ids.length * NODE_W + (ids.length - 1) * H_GAP;
          let ox = centerX - totalW / 2;
          const oy = this.tierY[tier] ?? this.tierY['0'];
          for (const id of ids) {
            this.nodePos[id] = { x: ox, y: oy };
            ox += NODE_W + H_GAP;
          }
        }
      }
    }

    // Save focus tier Y for use in renderFocus
    this.focusTierY = { ...this.tierY };

    // Compute focus-specific tier band bounds from focus node positions
    {
      const pad = 16;
      const fBands: Record<string, { top: number; bottom: number }> = {};
      for (const [vId, pos] of Object.entries(this.nodePos)) {
        const canonId = this.canonicalOf[vId] || vId;
        const art = this.allArtifacts[canonId];
        if (!art) continue;
        const cfg = this.cfgFor(art);
        if (!cfg) continue;
        const tier = String(cfg.tier);
        if (!fBands[tier]) {
          fBands[tier] = { top: pos.y - pad, bottom: pos.y + NODE_H + pad };
        } else {
          fBands[tier].top    = Math.min(fBands[tier].top,    pos.y - pad);
          fBands[tier].bottom = Math.max(fBands[tier].bottom, pos.y + NODE_H + pad);
        }
      }
      this.focusTierBandBounds = fBands;
    }

    this.focusLayout = false;

    // Transfer focus layout results to focus-specific fields
    this.focusNodePos         = { ...this.nodePos };
    this.focusCanonicalOf     = { ...this.canonicalOf };
    this.focusPrimaryVisualOf = { ...this.primaryVisualOf };

    // Restore main-canvas layout state
    this.tierY          = savedTierY;
    this.nodePos        = savedNodePos;
    this.canonicalOf    = savedCanonicalOf;
    this.primaryVisualOf = savedPrimaryVisualOf;

    // Plan bounding boxes for focus layout (use focus canonicalOf)
    for (const pid of planIds) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [vId, pos] of Object.entries(this.focusNodePos)) {
        const cId = this.focusCanonicalOf[vId] || vId;
        const art = this.allArtifacts[cId];
        if (!art || art.plan !== pid) continue;
        minX = Math.min(minX, pos.x);          minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + NODE_W); maxY = Math.max(maxY, pos.y + NODE_H);
      }
      if (isFinite(minX)) {
        this.focusPlanBounds[pid] = { x: minX - 14, y: minY - 14, w: maxX - minX + 28, h: maxY - minY + 28 };
      }
    }
  }

  private renderFocus(): void {
    if (!this.focusOpen) return;
    this.resizeFocusCanvas();
    this.fCtx.clearRect(0, 0, this.focusCanvas.width, this.focusCanvas.height);
    this.drawDotGrid(this.fCtx, this.focusCanvas.width, this.focusCanvas.height, this.fPanX, this.fPanY, this.fScale);
    this.fCtx.save();
    this.fCtx.translate(this.fPanX, this.fPanY);
    this.fCtx.scale(this.fScale, this.fScale);

    const focusSet   = new Set(this.focusNodeIds);
    const focusLinks = this.allLinks.filter(lk => focusSet.has(lk.src) && focusSet.has(lk.tgt));
    const focusArt: Record<string, ArtEntry> = {};
    for (const id of this.focusNodeIds) {
      if (this.allArtifacts[id]) focusArt[id] = this.allArtifacts[id];
    }

    // Swap in focus-specific layout state so drawScene renders correctly
    const savedCanonicalOf     = this.canonicalOf;
    const savedPrimaryVisualOf = this.primaryVisualOf;
    const savedTierBandBounds  = this.tierBandBounds;
    const savedTierY           = this.tierY;
    const savedAllArtifacts    = this.allArtifacts;
    this.canonicalOf     = this.focusCanonicalOf;
    this.primaryVisualOf = this.focusPrimaryVisualOf;
    this.tierBandBounds  = this.focusTierBandBounds;
    this.tierY           = this.focusTierY;
    this.allArtifacts    = focusArt;

    this.drawScene(
      this.fCtx, this.focusNodePos, this.focusPlanBounds, focusArt, focusLinks,
      this.selectedId, this.getHighlightedNodes(), this.modeImpact
    );

    this.canonicalOf     = savedCanonicalOf;
    this.primaryVisualOf = savedPrimaryVisualOf;
    this.tierBandBounds  = savedTierBandBounds;
    this.tierY           = savedTierY;
    this.allArtifacts    = savedAllArtifacts;

    this.fCtx.restore();
  }

  // ─── Public Selection API ────────────────────────────────────────────────────

  public selectArtifact(id: string, openFocusView = false): void {
    if (!id || !this.allArtifacts[id]) return;
    this.selectNode(id);
    if (openFocusView) this.openFocus();
  }

  // ─── Tooltip ─────────────────────────────────────────────────────────────────

  private updateTooltip(art: ArtEntry | null, screenX: number, screenY: number): void {
    if (!art || !this.tooltipEl) {
      this.tooltipEl?.classList.remove('visible');
      return;
    }
    const cfg = this.cfgFor(art);
    this.tooltipEl.textContent = (cfg?.label ?? art.type) + ': ' + (art.label || art.id);
    this.tooltipEl.style.left = screenX + 'px';
    this.tooltipEl.style.top  = (screenY - 4) + 'px';
    this.tooltipEl.classList.add('visible');
  }

  // ─── Layers Panel ─────────────────────────────────────────────────────────────

  private buildLayersPanel(): void {
    if (!this.layersPanel) return;
    this.layersPanel.innerHTML = '';
    const rows = [
      { tier: '5',   label: 'Plan',            color: '#7357ff' },
      { tier: '4.5', label: 'Sections',        color: '#4f46e5' },
      { tier: '4',   label: 'Output Products', color: '#dc3545' },
      { tier: '3',   label: 'Visual Tools',    color: '#198754' },
      { tier: '2',   label: 'List Boards',     color: '#3170aa' },
      { tier: '1',   label: 'Lists',           color: '#198754' },
      { tier: '0',   label: 'Cards',           color: '#5b687b' },
      { tier: '-1',  label: 'References',      color: '#3170aa' },
    ];
    for (const row of rows) {
      const item = document.createElement('label');
      item.className = 'am-layers-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !this.hiddenTiers.has(row.tier);
      cb.addEventListener('change', () => {
        if (cb.checked) this.hiddenTiers.delete(row.tier);
        else this.hiddenTiers.add(row.tier);
        this.renderAll();
        if (this.focusOpen) this.renderFocus();
      });
      const dot = document.createElement('div');
      dot.className = 'am-layers-dot';
      dot.style.background = row.color;
      const lbl = document.createElement('span');
      lbl.textContent = row.label;
      item.appendChild(cb);
      item.appendChild(dot);
      item.appendChild(lbl);
      this.layersPanel.appendChild(item);
    }
  }
}
