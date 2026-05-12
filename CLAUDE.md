# Onebrief Claude Code Knowledge Base

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
