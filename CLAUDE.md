# Onebrief Claude Code — Operational Config
> Last updated: June 2026

## Who Josh Is

Josh Lobdell — formerly Partner Engagement Manager (IC4), International & GCC Delivery Team (GDT). As of June 15, 2026, permanently transitioned to Product Operations Manager (IC2) on the ProdOps team. Reports to Adam Stoddard. Works closely with Ben Jameson (Jaymoe), Cesar Mize, Heather Priestley, Dennis Hull, and Josh Favaloro.

Background: Former PSYOP/ARSOF officer. Applies influence operations doctrine to customer adoption strategy. Thinks in "by, with, and through" frameworks. Practitioner voice, not consultant voice.

Notion user ID: `1d5d872b-594c-81b0-b92d-0002926a5022`

---

## Active Roles

Josh operates across three interconnected contexts. Each has a dedicated agent:

| Role | Agent | Status |
|---|---|---|
| Product Operations Manager | `agents/prodops-assistant.md` | Primary — daily work |
| Partner Engagement Manager (GDT) | `agents/gdt-assistant.md` | Active but secondary — field support continues |
| Engineering / Prototyping | `agents/onebrief-engineer.md` | Active — Artifact Syncs and future prototypes |

---

## ProdOps Context

**Team:** Adam Stoddard (manager), Ben Jameson / Jaymoe (product co-lead), Cesar Mize (product co-lead), Heather Priestley (QA lead, Docs), Angel Hernandez (SDET), Matthew Epler (Principal Product Designer)

**Primary collaborators:** Dennis Hull, Josh Favaloro

**Core mandate:**
- Notion knowledge management and Product teamspace infrastructure
- CR-to-Product visibility and feedback lifecycle ownership
- Feature release coordination and flag enablement
- PRD work and requirements documentation
- Post-launch validation and close-out

**Jaymoe's prescribed ProdOps workflow (treat as standing process):**
1. Trace feedback to discrete commands/sections via Reforge
2. Centralize and sort by volume
3. Provide list to Heather for EA roster
4. Batch via feature flag segments tool
5. Define EA/GA conditions with Nbox
6. Manage comms so Nbox can stay heads down

**Key shorthands:**
- "The Feature Lifecycle Proposal" = `387e3bdd` — ProdOps ownership from feedback intake through post-launch
- "Mission Control RFC" = `380e3bdd` — single system of record for full pipeline
- "SDLC doc" = `37de3bdd` — Consolidated SDLC Initiatives
- "Phase 1 PRD" = `357e3bdd` — Docs Overhaul Phase 1, locked, July 1 deadline
- "Inline Editing PRD" = `383e3bdd-8025`
- "Document Formatting doc" = `38ae3bdd` — Phase 2 scoping reference, all seven sections with EA/GA conditions

---

## GDT / Delivery Context

Josh continues to support GDT accounts. Full profile: `agents/context/josh-gdt-profile.md`

**Shorthands:**
- "The SOP" = Onebrief Customer Lifecycle SOP (Phase 0–3)
- "TTT / cohort model" = Train-the-Trainer / internal champion framework
- "Go/No-Go" = Pilot Qualification / Conditions-Check Framework

**Active accounts (abbreviated):**
- EUCOM/USAREUR-AF — pipeline (pilot ended Apr 30, no contract)
- CENTCOM — active, FoC/Atom Engine pilot
- JFC-Naples — active pilot, PoP Apr 7–Oct 31 2026
- NAVEUR — active, Naples-based
- Italy General Staff — pilot scoping
- Fort Bragg/ARSOF — proximity/one-offs

**Writing rules (always apply to GDT work):**
- No em-dashes — use commas, semicolons, or restructure
- Lead with problem and solution; do not over-explain
- Military terminology is correct: MDMP, J-staff, battle rhythm, CONOP, OPORD, CCIR, JELC
- Documents read like a practitioner wrote them, not a consultant

---

## Engineering / Prototyping Context

**Current project:** Artifact Syncs — Canvas 2D visualization overlay showing how all artifacts in a military planning brief relate to each other.

| File | bc path |
|---|---|
| `features/ArtifactMap/getArtifactMapData.ts` | `packages/bc-app/src/utils/ArtifactMap/` |
| `features/ArtifactMap/ArtifactMapEngine.ts` | `packages/bc-app/src/utils/ArtifactMap/` |
| `features/ArtifactMap/ArtifactMapOverlay.tsx` | `packages/bc-app/src/utils/ArtifactMap/` |

**Deploy:**
```bash
bash /tmp/claude-0/Claude/tools/deploy-artifact-map.sh
```

**Entry point in bc-app:**
`packages/bc-app/src/components/Brief/SideNav/PlanDropdownMenu.tsx`

Full spec: `docs/specs/artifact-map.md`

---

## Notion — Key Page IDs

### ProdOps
| Page | ID |
|---|---|
| Product Hub (wiki) | `5762620e` |
| PM + ProdOps Workspace | `288e3bdd-bbab5e` |
| Product Document Database | `288e3bdd-8012` |
| Product Archive | `382e3bdd-802f` |
| Feature Lifecycle Ownership proposal | `387e3bdd` |
| Document Formatting — Phase 2 scoping | `38ae3bdd` |
| Inline Editing PRD | `383e3bdd-8025` |
| Orgs & Groups PRD template | `37be3bdd` |
| Feature Flag Management Proposal | `383e3bdd-811d` |
| Feature Flag Segmentation — CR Enablement Guide | `383e3bdd-81e2` |
| Feature Flag Homepage | `2afe3bdd-80e6` |
| Consolidated SDLC Initiatives | `37de3bdd` |
| RFC: Mission Control | `380e3bdd` |
| PRD: Docs Overhaul Phase 1 | `357e3bdd` |
| Phase 1b: In-Line Editing | `2afe3bdd` |
| Midyear Review | `329e3bdd` |
| Josh profile | `232e3bdd` |

### GDT
| Page | ID |
|---|---|
| Go/No-Go Framework | `350e3bdd` |
| CENTCOM FoC Conditions Check | `34ae3bdd` |
| Training Glide Path | `364e3bdd-8187` |
| Customer POI Framework | `364e3bdd-81f6` |
| Customer Lifecycle SOP | `225e3bdd` |
| CYBERCOM Lessons Learned | `304e3bdd` |
| Int'l GCC Delivery Team | `230e3bdd` |
| GDT Hub | `8cfee9ce` |
| JFC-N Pilot | `344e3bdd` |
| NAVEUR | `26be3bdd` |
| CENTCOM | `269e3bdd` |
| Italy Pilot | `8a56acac` |
| Project DYNAMIS | `5de12c52` |

---

## Figma

User: josh.lobdell@onebrief.com (View seat — MCP read-only)
Org key: `organization::1437730002211741036`

| File | Key |
|---|---|
| AI Assist | `WGGGm01D63mRn34Ycky6yy` |
| Document Enhancements | `ZAWmwGe6OuglCNmCr6aoAB` |
| Timelines v2 Creator | `bGPNtDZ3mlfpD5YQBcFM5h` |
| User Dashboard & Homepage | `L3VQLFDMoqsEhBLvhW9dDL` |
| ODS v2 Whiteboard | `8wvUlvKferK1Xievxm3s5q` |

---

## Storybook MCP Server

Location: `/home/user/Claude/storybook-mcp/index.js`
Live URL: `https://ods.onebrief.com` (IP-restricted)

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

---

## Notion API — Hard-Won Rules

- Wiki databases (including Product Hub `5762620e`) return only schema via `notion-fetch` — body content must be edited manually in the UI
- Toggle blocks are not real page IDs and cannot be used as move targets
- `notion-move-pages` frequently reports success but does not actually move databases nested inside databases — manual sidebar move required first
- Pages moved into a wiki via API often fail to register as proper wiki entries — fix by manually unchecking/rechecking "Highlight on Home"
- **Never use `allow_deleting_content: true`** — caused cascading deletion of an entire database
- Always fetch a page before moving, archiving, or reporting its status
- Moving pages into Product Document Database requires `data_source_id` as parent type, not `page_id`
- `notion-search` does not reliably confirm nesting — fetch directly and inspect the parent field

---

## Operational Defaults

- Never delete anything without two explicit confirmations — archive always preferred
- Work one task at a time with explicit confirmation before execution
- Do not call out colleagues by name in documents
- Do not continue proposing options after something has been tried and ruled out
- When pushing to Notion, confirm the target page before writing
