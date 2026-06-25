# Onebrief Product Context

## What Onebrief Is

Military planning software for US and allied armed forces. Core product: collaborative brief-building environment (bc) where planners create, organize, and share military planning artifacts across a hierarchical structure of plans, sections, boards, lists, and cards.

Josh's role: Product/engineering, focused on AI and advanced feature development.

---

## Customer Hierarchy (as of May 2026)

Organized by Military Service / CCMD.
FigJam overview: `figma.com/board/WpOFrLJ9tJjGeWujbvnYuN`

### Churned (do not include)
- INDOPACOM HQ (churned Feb 2026)
- USCYBERCOM (churned Feb 27, 2026)
- III MEF (IPC contagion)

### Active Customers

| Account | Service / CCMD | ARR | Status |
|---|---|---|---|
| Joint Staff | Joint | $7.5M | Active |
| SPACECOM | Central | $3.5M | Active |
| ASW (OSW) | East | $4M | Active |
| MARFORPAC | USMC/CMC | $4.5M | At-Risk |
| INDOPACOM AOR: PACAF | Air Force/DAF | $3M | At-Risk |
| CENTCOM | Geographic CCMD | $2.4M | Active |
| PACFLT / 7th Fleet | Navy/CNO | $2.4M | Active |
| I Corps (JBLM) | Army/FORSCOM | $2.6M | At-Risk |
| III Corps | Army/FORSCOM | $2.5M | Active |
| ArmyU / CGSC | Army/TRADOC | $563K | Active |
| CASCOM | Army/TRADOC | $150K | Active |
| AMC | Air Force/DAF | — | Active |
| ACC | Air Force/DAF | — | Active |
| 603rd AOC Ramstein | ACC / EUCOM AOR | — | Active |
| NAVEUR | Navy/CNO | — | Active |
| SURFLANT/SURPAC | Navy/CNO | — | Active |
| 1st Cav Div | under III Corps | — | Active |
| 1st AD | under III Corps | — | Onboarding |
| XVIII ABN Corps | Army/FORSCOM | — | Contracted/NTP Pending |
| 4th ID / NGC2 | Army/FORSCOM | — | Active |
| ARSOF CCC / SWCS | SOCOM | — | Active |
| SOCPAC | SOCOM | — | Active |
| USFJ | Geographic CCMD | — | Active |
| NATO SHAPE / JFC Naples | Joint | — | At-Risk (pilot, no contract) |
| I MEF / 3rd MARDIV | USMC | — | Active (paid pilot) |
| 3rd Fleet (C3F) | under PACFLT | — | Onboarding |
| MARFORPAC | USMC | — | At-Risk |

### Pipeline
SOCOM HQ, STRATCOM, NRO, USARC, Indiana NG/38th ID, USARSOUTH, Italian Army, Taiwan, UK, KSA/UAE, USMC PP&O

### EUCOM Status
EUCOM/USAREUR-AF — pilot ended Apr 30 2026, no contract signed → Pipeline

---

## Military Planning Domain Concepts

**Brief / Plan** — The top-level planning document. Everything in bc lives inside a brief.

**Section** — Organizational container within a brief (e.g. "Annex A", "Task Organization"). Sections can nest.

**Board** — A visual workspace within a section. Types: list board (cards/lists), C2 diagram, timeline, map, whiteboard, cause & effect.

**List** — Ordered column of cards within a board (also called "section" in the OT layer).

**Card / Node** — Atomic unit of planning content. Can be synced across plans.

**Cross-plan sync** — A card created in Plan A appears in Plan B's list. The card's `briefId` stays as Plan A's ID — this is the only reliable ownership signal.

**WARNO / Order** — A military order document (Warning Order, Operations Order). Stored as an `orders` OT type; contains a docId pointer to a rich-text document.

**C2 diagram** — Command and Control relationship diagram. Nodes are military units (`c2_units`), not regular cards.

**Cause & Effect** — A `map`-type board upgraded to `cause_effect` when edges exist between its nodes.
