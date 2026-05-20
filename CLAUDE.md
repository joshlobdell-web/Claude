# Onebrief Claude Code Knowledge Base

## Artifact Map Feature
Self-contained Canvas 2D visualization of how artifacts (cards → lists → boards → sections → output products → plan) relate to each other across a brief.

### Files
| File | App destination |
|---|---|
| `ArtifactMap/getArtifactMapData.ts` | `packages/bc-app/src/utils/ArtifactMap/getArtifactMapData.ts` |
| `ArtifactMap/ArtifactMapEngine.ts` | `packages/bc-app/src/utils/ArtifactMap/ArtifactMapEngine.ts` |
| `ArtifactMap/ArtifactMapOverlay.tsx` | `packages/bc-app/src/utils/ArtifactMap/ArtifactMapOverlay.tsx` |

**Deploy command** (run on host machine after pushing):
```bash
cd /tmp/claude-repo && git pull && cp ArtifactMap/getArtifactMapData.ts ArtifactMap/ArtifactMapEngine.ts /root/repos/bc/packages/bc-app/src/utils/ArtifactMap/
```

---

### Data Model (`getArtifactMapData.ts`)

#### Display types
`plan | section | document | presentation | c2board | timeline | map | whiteboard | cause_effect | board | list | card | reference`

#### Link types
- `contains` — primary parent relationship (drives layout tree)
- `pins` — secondary embedding (document references a list, whiteboard embeds a board, etc.)
- `sourced_from` — card ← uploaded reference doc
- `ghost` — synced copy of a card in another plan

#### 7-phase async pipeline
| Phase | What it does |
|---|---|
| 1 — Section tree | `collab.briefs.getNestedStructureWithBrief()` walk; emits sections, documents, orders, presentations, maps, whiteboards; populates `boardsInSections` map |
| 2 — Board IDs | Collects numeric board IDs + prefetches `getTitleAndType` |
| 3 — Widgets | Processes whiteboard/presentation widgets; emits `pins` links to embedded lists/maps/boards |
| 4 — Source docs | `emitSourceDocLink` for `fileDocumentId` on card/C2 nodes |
| 5 — Boards | `processBoard` → `processListBoard / processC2Board / processDirectNodeBoard`; assigns `contains: board → list → card` |
| 5.5 — Map overlays | Pins from map overlay features to cards/lists |
| 5.9 — Fallback parent | Any artifact still without `primaryParent` after Phase 5 gets `contains: plan → artifact` |
| 6 — C&E upgrade | Boards with cross-node edges → `cause_effect` type |
| 7 — Cross-plan sync | Cards appearing in lists of other plans get `syncedToOtherPlans = true` |

#### Key design rules
- `primaryParent` map — once set, prevents duplicate `contains` links; later phases emit `pins` instead
- Early phases (widgets, documents, orders, maps) **only emit `emitArtifact` + `pins`** — they never set `primaryParent`; Phase 5 owns all `contains` assignments for lists/cards
- `boardsInSections = Map<numericBoardId, sectionArtId>` — set in Phase 1, read in Phase 5 to wire `contains: section → board`

#### Order/document API facts (confirmed in production)
- `collab.orders.get(orderId)` → `{ docId: number, title, ... }`
- `collab.documents.get(docId)` → 14-key record; PM content is at `record.snapshot` (type `doc`, content array)
- PM node type for embedded lists: `card_list` with `attrs.listId`
- `getNodeDocument(id)` returns `null` for order/standalone documents; only works for node text docs
- `collectPmListIds(pmNode)` walks any PM tree and extracts all `listId`/`sectionId` attrs regardless of node type name

---

### Rendering Engine (`ArtifactMapEngine.ts`)

#### Tier layout (Y positions, plan at top)
| Tier | Type | Color |
|---|---|---|
| 5 | plan | purple `#7357ff` |
| 4.5 | section | indigo `#4f46e5` |
| 4 | document, presentation | red / slate |
| 3 | c2board, timeline, map, whiteboard, cause_effect | various |
| 2 | board (list board) | blue `#3170aa` |
| 1 | list | green `#198754` |
| 0 | card | slate `#5b687b` |
| −1 | reference | blue (below cards) |

#### Connection anchors
- `contains` links — **vertical**, child top-center → parent bottom-center (arrows point upward; plan only receives, cards only emit)
- `pins` / `ghost` / `sourced_from` links — **horizontal**, left/right sides based on relative X position

#### Virtual card nodes
Cards in lists use virtual IDs `${cardId}⊕${listId}` in `nodePos`/`canonicalOf`/`primaryVisualOf`. A card in 3 lists has 3 virtual nodes. Only the virtual node whose parent list is in the highlighted chain is lit up (prevents cross-list ghost highlighting).

#### Selection modes
- **Normal (bidirectional BFS)** — `bfsBidirectional()`: Phase 1 goes ALL the way up (every ancestor to plan); Phase 2 goes ALL the way down (every descendant to cards). Phases are independent — going down does not trigger another upward pass.
- **Impact (upward-only BFS)** — `bfsImpact()`: what would change if this artifact changes. Follows `contains`/`pins` upward, `ghost` forward (sync copies are impacted), does NOT flow down.
- **Focus overlay** — re-runs layout algorithms (`layoutPlan`/`layoutSection`/`layoutBoard`/`layoutList`) scoped to only the highlighted node set, using compact `computeFocusTierY`. Stores results in `focusCanonicalOf`/`focusPrimaryVisualOf`; `renderFocus` swaps these in before calling `drawScene`.

---

## Notion Workspace
- Connected via Notion MCP
- Key pages:
  - [Account Owner Dashboard (Main)](https://www.notion.so/250e3bddbaa8803b83f2d08a0f461db1) — `collection://250e3bdd-baa8-8070-9a71-000b197a1f5d`
  - [Account Dashboards](https://www.notion.so/250e3bddbaa880f2be04e80c1ab1052f)
  - [ODSv2 Design Index](https://www.notion.so/342e3bddbaa880af9786efcee2ee2f66)
  - [Customer Relations Wiki](https://www.notion.so/bd2efd0c617044b183b9224d58d57f60)
  - [Customer Onboarding Dashboard](https://www.notion.so/237e3bddbaa880539577eb023cdfc0aa)

## Figma
- User: josh.lobdell@onebrief.com (View seat — MCP read-only, rate limited)
- Org key: `organization::1437730002211741036`
- Design files (read-only reference):
  - AI Assist: `figma.com/design/WGGGm01D63mRn34Ycky6yy`
  - Document Enhancements: `figma.com/design/ZAWmwGe6OuglCNmCr6aoAB`
  - Timelines v2 Creator: `figma.com/design/bGPNtDZ3mlfpD5YQBcFM5h`
  - User Dashboard & Homepage: `figma.com/design/L3VQLFDMoqsEhBLvhW9dDL`
  - ODS v2 Whiteboard (FigJam): `figma.com/board/8wvUlvKferK1Xievxm3s5q`
- Key contacts: Alex Zelenak (alex.zelenak@onebrief.com) — AI Assist; Audrey Bastian (audrey.bastian@onebrief.com) — Timelines

## Storybook MCP Server
- Location: `/home/user/Claude/storybook-mcp/index.js`
- Cached ODS index: `/home/user/Claude/storybook-mcp/ods-index.json`
- Live URL: `https://ods.onebrief.com` (IP-restricted, not accessible via WebFetch)
- To register in Claude Code settings:
  ```json
  {
    "mcpServers": {
      "storybook-ods": {
        "command": "node",
        "args": ["/home/user/Claude/storybook-mcp/index.js"],
        "env": {
          "STORYBOOK_BASE_URL": "https://ods.onebrief.com",
          "STORYBOOK_SESSION_COOKIE": ""
        }
      }
    }
  }
  ```

## ODS Component Library (Onebrief Design System v5)
All components are prefixed `ODS` and built in React/TypeScript.

### Buttons & Controls
- ODSButton — Default, CTA, Quiet, Outline, Toolbar, Toggle, Icon Only, sizes XS–LG
- ODSSplitButton, ODSDropdownToggle, ODSSegmentedControl

### Inputs & Forms
- ODSInput — Text, Textarea, Select, Range, prefix/suffix variants
- ODSInputGroup, ODSSelect (creatable, multi), ODSCheckbox, ODSRadioButton
- ODSToggle, ODSSwitch, ODSSlider, ODSSearchBar, ODSFormGroup, ODSLabel

### Feedback & Alerts
- ODSAlert — Warning, Error, Info, Success, Help
- ODSBanner — Warning, Error, Success, Full Width, with links/markdown
- ODSCallout, ODSToast — Warning, Error, Success, with Action/Spinner
- ODSProgressBar, ODSSpinner

### Overlays & Menus
- ODSModal, ODSModalV2, ODSModalContainer
- ODSPopover (click/hover triggers), ODSContextMenu, ODSContextMenuItem
- ODSDropdown, ODSDropdownMenu (multi-level), ODSDropdownItem
- ODSPasteDialog

### Navigation
- ODSNav — Default, Tabs, Slim Tabs, Navbar
- ODSTabs, ODSTab, ODSNavbar, ODSToolbar, ODSToolbarDivider, ODSToolbarLabel

### Display & Layout
- ODSBadge — Default, Pill, Circle, Colors, Outline, Transparent
- ODSCard, ODSTile — Default, Button, Checkbox, Radio, Status, Media, Detail Pane
- ODSTable — Full Width, Floating, Striped, Hover, Compact, Bordered
- ODSListGroup, ODSListItem, ODSGrid, ODSGroup, ODSCollapse, ODSContainer

### Coaching & Onboarding
- ODSCoachMark — 10 color variants, custom icons, emoji support
- ODSFloatingCoachMark — Stationary, Bouncy, With Image
- ODSDismissibleNotice, ODSDismissibleNoticeImage

### Misc
- ODSTooltip, ODSTimestamp, ODSColorPalette, ODSIcon (Font Awesome + ODS icons)
- ODSLogo, ODSEmptyState, ODSMetaBadge, ODSFilterBadge, ODSInfo
- ODSAnimateBanner, ODSAnimation (Progress, Fade), ODSDotDotDot

### Documentation Sections
Styling (Colors, Spacing, Sizing, Text, Units, Dark UI, Z-Index),
Icons, Interactions (Universal Behaviors, Shortcuts),
Patterns (Forms, Toolbars, Context Menus, Messages, Empty States, Date/Time, Classification)

## Customer Hierarchy (as of May 2026)
Organized by Military Service / CCMD. FigJam diagram: `figma.com/board/WpOFrLJ9tJjGeWujbvnYuN`

### Churned (do not include)
- INDOPACOM HQ (churned Feb 2026)
- USCYBERCOM (churned Feb 27, 2026)
- III MEF (IPC contagion)

### Active Customers
| Account | Region/Service | ARR | Status |
|---|---|---|---|
| CENTCOM | Geographic CCMD | $2.4M | Active |
| Joint Staff | Joint | $7.5M | Active |
| SPACECOM | Central | $3.5M | Active |
| ASW (OSW) | East | $4M | Active |
| PACFLT / 7th Fleet | Navy/CNO | $2.4M | Active |
| MARFORPAC | USMC/CMC | $4.5M | At-Risk |
| INDOPACOM AOR: PACAF | Air Force/DAF | $3M | At-Risk |
| MARFORPAC | USMC | — | At-Risk |
| AMC | Air Force/DAF | — | Active |
| ACC | Air Force/DAF | — | Active |
| 603rd AOC Ramstein | under ACC / EUCOM AOR | — | Active |
| NAVEUR | Navy/CNO | — | Active |
| SURFLANT/SURPAC | Navy/CNO | — | Active |
| I Corps (JBLM) | Army/FORSCOM | $2.6M | At-Risk |
| III Corps | Army/FORSCOM | $2.5M | Active |
| 1st Cav Div | under III Corps | — | Active |
| 1st AD | under III Corps | — | Onboarding |
| XVIII ABN Corps | Army/FORSCOM | — | Contracted/NTP Pending |
| 4th ID / NGC2 | Army/FORSCOM | — | Active |
| ArmyU / CGSC | Army/TRADOC | $563K | Active |
| CASCOM | Army/TRADOC | $150K | Active |
| ARSOF CCC / SWCS | SOCOM | — | Active |
| SOCPAC | SOCOM | — | Active |
| USFJ | Geographic CCMD | — | Active |
| NATO SHAPE / JFC Naples | Joint | — | At-Risk (pilot, no contract) |
| I MEF / 3rd MARDIV | USMC | — | Active (paid pilot) |
| 3rd Fleet (C3F) | under PACFLT | — | Onboarding |

### Pipeline
SOCOM HQ, STRATCOM, NRO, USARC, Indiana NG/38th ID, USARSOUTH, Italian Army, Taiwan, UK, KSA/UAE, USMC PP&O

### EUCOM Status
EUCOM/USAREUR-AF — pilot ended Apr 30 2026, no contract signed → Pipeline
