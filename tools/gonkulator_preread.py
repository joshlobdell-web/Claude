#!/usr/bin/env python3
"""
gonkulator_preread.py — Onebrief Gonkulator Pre-Read Generator

Pulls Reforge Insights signal, clusters semantically via Claude, scores each
cluster against the six Gonkulator factors (Annex B), ranks by weighted total,
and writes a dated pre-read page to Notion.

Requirements:
    pip install anthropic requests

Usage:
    ANTHROPIC_API_KEY=sk-... python3 gonkulator_preread.py

Auth tokens are read from ~/.claude/.credentials.json (written by Claude Code
MCP auth). Override with env vars: REFORGE_TOKEN, NOTION_TOKEN.

Rules (Annex B):
  - Effort is never a factor.
  - Score runs as a loop — each run creates a fresh dated page.
  - NULL factors are excluded from the denominator (score normalises to available data).
  - >1 NULL factor → cluster flagged "incomplete — human input required".
  - Sort key: weighted score only. No secondary sort.
"""

import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import anthropic
import requests


# ─── Config ───────────────────────────────────────────────────────────────────

REFORGE_MCP_URL = "https://insights.reforge.com/api/v1/mcp"
WORKSPACE_ID    = "cmf32fhf00075ad01embtv4nn"
NOTION_API_BASE = "https://api.notion.com/v1"
NOTION_API_VER  = "2022-06-28"
PARENT_PAGE_ID  = None   # None → private workspace-level page (Notion library)
MODEL           = "claude-sonnet-4-6"

MAX_SNIPPETS_FOR_CLUSTERING = 2000   # top-N by Reforge score if corpus is larger
SNIPPET_TRUNCATE_CHARS      = 300    # per snippet for the clustering pass
MAX_SNIPPETS_FOR_SCORING    = 30     # snippets sent per cluster to Claude for scoring

QUERIES = [
    "Feedback about planning workflow problems and friction",
    "Feedback about document editing and formatting issues",
    "Feedback about collaboration and sharing difficulties",
    "Feedback about integrations and data import export",
    "Feedback about user interface and navigation friction",
    "Feedback about permissions and access control issues",
    "Feedback about agentic AI and automation requests",
    "Feedback about training and onboarding difficulty",
    "Feedback about performance and reliability issues",
    "Feedback about feature requests from military commands",
    "Feedback about headquarters workflow gaps",
    "Feedback about briefing and presentation problems",
    "Feedback about timeline and approval workflow issues",
    "Feedback about search and discovery problems",
    "Feedback about mobile and cross-platform issues",
]

# (key, display_name, weight, notes_field)
FACTOR_DEFS = [
    ("operational_impact",  "Operational and mission impact",              20, "operational_notes"),
    ("revenue_stakes",      "Revenue and contract stakes",                 20, "revenue_notes"),
    ("market_opportunity",  "Market opportunity, uncontested white space", 20, "market_notes"),
    ("strategic_alignment", "Strategic alignment, fit to the four bets",   20, "strategic_notes"),
    ("urgency",             "Urgency, exercise/certification/contract window", 10, "urgency_notes"),
    ("customer_signal",     "Customer signal, volume and concentration",   10, "customer_notes"),
]

STRATEGIC_BETS = [
    "Core platform — plan, brief, and decide in one connected loop",
    "Agentic, the Future of Command",
    "Integrations at scale — War Data Platform, Maven Smart Systems, Ontology SDK",
    "Win the uncontested headquarters workflows",
]

_CHURN_RE = re.compile(
    r"\b(churn|cancel(?:l(?:ation|ing))?|not renew|non.?renewal|at.?risk|risk of loss|"
    r"switch(?:ing)? (?:to|away|from)|go with|alternative|competitor|replac(?:e|ing)|"
    r"leav(?:ing|e) (?:the )?(?:platform|product|tool)|"
    r"drop(?:ping)? (?:the )?(?:tool|product|platform|subscription))\b",
    re.IGNORECASE,
)

_ACCOUNT_RES = [
    re.compile(r"Command/Account Name:\s*([^,\n]+)", re.IGNORECASE),
    re.compile(r"HQ or Other Entity:\s*([^,\n]+)",   re.IGNORECASE),
    re.compile(r"Organization:\s*([^,\n]+)",          re.IGNORECASE),
    re.compile(r"Unit:\s*([^,\n]+)",                  re.IGNORECASE),
]


# ─── Credentials ──────────────────────────────────────────────────────────────

def load_tokens() -> dict:
    """
    Load Reforge and Notion OAuth tokens.
    Priority: environment variables > ~/.claude/.credentials.json
    """
    tokens: dict[str, str] = {}

    creds_path = Path.home() / ".claude" / ".credentials.json"
    if creds_path.exists():
        try:
            creds = json.loads(creds_path.read_text())
            mcp = creds.get("mcpOAuth", {})
            rk = next((k for k in mcp if "reforge" in k), None)
            nk = next((k for k in mcp if "notion"  in k), None)
            if rk:
                tokens["reforge"] = mcp[rk]["accessToken"]
            if nk:
                tokens["notion"] = mcp[nk]["accessToken"]
        except Exception as exc:
            print(f"  Warning: could not read credentials file: {exc}", file=sys.stderr)

    if os.environ.get("REFORGE_TOKEN"):
        tokens["reforge"] = os.environ["REFORGE_TOKEN"]
    if os.environ.get("NOTION_TOKEN"):
        tokens["notion"] = os.environ["NOTION_TOKEN"]

    missing = [name for name in ("reforge", "notion") if name not in tokens]
    if missing:
        sys.exit(
            f"ERROR: Missing tokens for: {', '.join(missing)}.\n"
            "Authenticate via Claude Code (opens ~/.claude/.credentials.json)\n"
            "or set REFORGE_TOKEN / NOTION_TOKEN env vars."
        )
    return tokens


# ─── Reforge MCP HTTP client ───────────────────────────────────────────────────

def _mcp_call(url: str, token: str, tool: str, args: dict):
    """
    POST a tools/call to a Streamable HTTP MCP server.
    Handles both JSON and SSE (text/event-stream) responses.
    Returns the unwrapped result content (Python object).
    """
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type":  "application/json",
            "Accept":        "application/json, text/event-stream",
        },
        json={
            "jsonrpc": "2.0", "id": 1,
            "method": "tools/call",
            "params": {"name": tool, "arguments": args},
        },
        timeout=90,
        stream=True,
    )
    resp.raise_for_status()

    ct = resp.headers.get("Content-Type", "")
    if "text/event-stream" in ct:
        result = None
        for line in resp.iter_lines(decode_unicode=True):
            if line.startswith("data: "):
                try:
                    d = json.loads(line[6:])
                    if "result" in d:
                        result = d["result"]
                except json.JSONDecodeError:
                    pass
    else:
        d = resp.json()
        if "error" in d:
            raise RuntimeError(f"MCP error: {d['error']}")
        result = d.get("result")

    if not result:
        return None

    # Unwrap MCP content envelope: result.content[0].text → parse JSON
    if isinstance(result, dict) and "content" in result:
        text = result["content"][0].get("text", "")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text

    return result


def _run_query(token: str, query: str) -> list[dict]:
    try:
        raw = _mcp_call(REFORGE_MCP_URL, token, "search_snippets", {
            "queryText":   query,
            "workspaceId": WORKSPACE_ID,
        })
        if isinstance(raw, list) and raw:
            return raw[0].get("snippets", [])
        if isinstance(raw, dict):
            return raw.get("snippets", [])
    except Exception as exc:
        print(f"  WARNING: query failed — {query[:55]}: {exc}", file=sys.stderr)
    return []


def fetch_all_signal(token: str) -> tuple[list[dict], int]:
    """Run all queries concurrently, deduplicate, return (snippets, raw_count)."""
    print(f"Pulling Reforge signal ({len(QUERIES)} queries, 5 concurrent)…")
    all_raw: list[dict] = []

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(_run_query, token, q): q for q in QUERIES}
        for fut in as_completed(futures):
            q   = futures[fut]
            snips = fut.result()
            all_raw.extend(snips)
            print(f"  {len(snips):4d}  {q[:70]}")

    raw_count = len(all_raw)

    # Deduplicate by snippetId
    seen: dict[str, dict] = {}
    for s in all_raw:
        sid = s.get("snippetId") or s.get("id")
        if sid and sid not in seen:
            seen[sid] = s

    deduped = list(seen.values())

    # Cap for clustering: take top-scoring snippets if corpus is very large
    if len(deduped) > MAX_SNIPPETS_FOR_CLUSTERING:
        deduped.sort(key=lambda x: x.get("score", 0), reverse=True)
        deduped = deduped[:MAX_SNIPPETS_FOR_CLUSTERING]

    print(
        f"\n  Raw: {raw_count}  →  Deduplicated: {len(seen)}"
        + (f"  →  Capped to top: {len(deduped)}" if len(seen) > MAX_SNIPPETS_FOR_CLUSTERING else "")
        + "\n"
    )
    return deduped, raw_count


# ─── Signal enrichment ─────────────────────────────────────────────────────────

def _extract_account_name(content: str) -> Optional[str]:
    for rx in _ACCOUNT_RES:
        m = rx.search(content)
        if m:
            return m.group(1).strip()
    return None


def enrich_snippets(snippets: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Add _acct_name, _acct_id, _churn fields in place.
    Return (attributed, unattributed).
    Unattributed = no account name in content AND no customerId.
    """
    attributed, unattributed = [], []
    for s in snippets:
        content = s.get("content", "")
        s["_acct_name"] = _extract_account_name(content)
        s["_acct_id"]   = s.get("customerId")
        s["_churn"]     = bool(_CHURN_RE.search(content))
        if s["_acct_name"] or s["_acct_id"]:
            attributed.append(s)
        else:
            unattributed.append(s)
    return attributed, unattributed


# ─── Clustering ────────────────────────────────────────────────────────────────

_CLUSTER_SYSTEM = """\
You are a product analyst for Onebrief, a military joint-force planning platform.

Task: cluster the feedback snippets into 8–20 distinct user problem groups.

Rules:
- Each cluster name is a specific, plain-language user problem
  (e.g. "Cross-plan sync silently drops AI-generated data on workspace switch")
- Cluster by underlying user problem — NOT by feature label, account, or strategic category
- Every snippet ID must appear in exactly one cluster
- Do NOT reference effort, complexity, or engineering cost anywhere
- Return ONLY the structured JSON via the provided tool
"""

_CLUSTER_TOOL_SCHEMA = {
    "type": "object",
    "required": ["clusters"],
    "properties": {
        "clusters": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["cluster_id", "cluster_name", "snippet_ids"],
                "properties": {
                    "cluster_id":   {"type": "integer"},
                    "cluster_name": {"type": "string"},
                    "snippet_ids":  {"type": "array", "items": {"type": "string"}},
                },
            },
        }
    },
}


def cluster_snippets(client: anthropic.Anthropic, snippets: list[dict]) -> list[dict]:
    print("Clustering snippets with Claude…")
    items = [
        {
            "id":   s.get("snippetId") or s.get("id"),
            "text": s.get("content", "")[:SNIPPET_TRUNCATE_CHARS],
        }
        for s in snippets
    ]
    resp = client.messages.create(
        model=MODEL,
        max_tokens=8096,
        system=_CLUSTER_SYSTEM,
        messages=[{
            "role": "user",
            "content": (
                f"Cluster these {len(items)} Onebrief feedback snippets "
                f"into semantic problem groups.\n\n"
                + json.dumps(items, indent=2)
            ),
        }],
        tools=[{
            "name":         "return_clusters",
            "description":  "Return clustered snippet groups",
            "input_schema": _CLUSTER_TOOL_SCHEMA,
        }],
        tool_choice={"type": "tool", "name": "return_clusters"},
    )
    for block in resp.content:
        if block.type == "tool_use":
            return block.input["clusters"]
    raise RuntimeError("Claude did not return clusters")


# ─── Scoring ────────────────────────────────────────────────────────────────────

_SCORE_SYSTEM = (
    "You are scoring a Onebrief product problem cluster against the Gonkulator "
    "— a weighted scoring model with six factors.\n\n"
    "The four strategic bets:\n"
    + "\n".join(f"  {i+1}. {b}" for i, b in enumerate(STRATEGIC_BETS))
    + "\n\n"
    "North Star: Onebrief is the planning layer of the joint force — "
    "mission essential, not mission enhancing. "
    "A staff should not need to leave Onebrief to plan, brief, decide, or execute.\n\n"
    "Scoring rules:\n"
    "- operational_impact (×20): How directly does this disrupt planning/briefing/decision flow? "
    "0 = no disruption | 10 = blocks a core mission workflow.\n"
    "- revenue_stakes (×20): Score ONLY if snippets contain explicit contract, "
    "renewal, or churn language. Otherwise return null.\n"
    "- market_opportunity (×20): Is this entirely unaddressed by the product (score high), "
    "partially addressed (mid), or mostly solved (low)?\n"
    "- strategic_alignment (×20): 0–10 fit to the most relevant bet above. "
    "0 and strategic_bet='Unaligned' if no bet applies.\n"
    "- urgency (×10): Score ONLY if snippets name an exercise window, "
    "certification deadline, or specific contract date. Otherwise return null.\n"
    "- customer_signal (×10): Based on snippet count + distinct accounts provided: "
    "low vol + 1 acct = 2 | high vol + 1 acct = 5 | "
    "low vol + multi acct = 6 | high vol + multi acct = 9–10.\n\n"
    "NEVER mention effort, complexity, or engineering cost."
)

_SCORE_TOOL_SCHEMA = {
    "type": "object",
    "required": [
        "operational_impact", "operational_notes",
        "revenue_stakes",     "revenue_notes",
        "market_opportunity", "market_notes",
        "strategic_alignment","strategic_bet", "strategic_notes",
        "urgency",            "urgency_notes",
        "customer_signal",    "customer_notes",
        "representative_snippets",
    ],
    "properties": {
        "operational_impact":  {"anyOf": [{"type": "number", "minimum": 0, "maximum": 10}, {"type": "null"}]},
        "operational_notes":   {"type": "string"},
        "revenue_stakes":      {"anyOf": [{"type": "number", "minimum": 0, "maximum": 10}, {"type": "null"}]},
        "revenue_notes":       {"type": "string"},
        "market_opportunity":  {"anyOf": [{"type": "number", "minimum": 0, "maximum": 10}, {"type": "null"}]},
        "market_notes":        {"type": "string"},
        "strategic_alignment": {"anyOf": [{"type": "number", "minimum": 0, "maximum": 10}, {"type": "null"}]},
        "strategic_bet":       {"type": "string", "description": "Exact bet name from the list above, or 'Unaligned'"},
        "strategic_notes":     {"type": "string"},
        "urgency":             {"anyOf": [{"type": "number", "minimum": 0, "maximum": 10}, {"type": "null"}]},
        "urgency_notes":       {"type": "string"},
        "customer_signal":     {"anyOf": [{"type": "number", "minimum": 0, "maximum": 10}, {"type": "null"}]},
        "customer_notes":      {"type": "string"},
        "representative_snippets": {
            "type": "array",
            "items": {"type": "string"},
            "description": "1–3 paraphrased examples with account attribution where available",
        },
    },
}


def score_cluster(
    client: anthropic.Anthropic,
    name: str,
    snippets: list[dict],
) -> dict:
    acct_ids   = {s["_acct_id"]   for s in snippets if s.get("_acct_id")}
    acct_names = {s["_acct_name"] for s in snippets if s.get("_acct_name")}
    churn      = any(s.get("_churn") for s in snippets)
    n_accts    = len(acct_ids) or len(acct_names)
    texts      = [s.get("content", "")[:600] for s in snippets[:MAX_SNIPPETS_FOR_SCORING]]

    resp = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        system=_SCORE_SYSTEM,
        messages=[{
            "role": "user",
            "content": (
                f'Cluster: "{name}"\n'
                f"Snippet count: {len(snippets)}\n"
                f"Distinct accounts: {n_accts}\n"
                f"Churn signals detected: {'Yes' if churn else 'No'}\n\n"
                "Snippets (up to 30):\n"
                + "\n---\n".join(texts)
            ),
        }],
        tools=[{
            "name":         "return_scores",
            "description":  "Return Gonkulator scores for this cluster",
            "input_schema": _SCORE_TOOL_SCHEMA,
        }],
        tool_choice={"type": "tool", "name": "return_scores"},
    )
    for block in resp.content:
        if block.type == "tool_use":
            sc = block.input
            sc["_n_snippets"] = len(snippets)
            sc["_n_accts"]    = n_accts
            sc["_churn"]      = churn
            return sc
    raise RuntimeError(f"Claude did not score cluster: {name}")


# ─── Weighted score calculation ────────────────────────────────────────────────

def calc_weighted_score(scores: dict) -> tuple[float, float, list[str]]:
    """
    Returns (total_weighted_pts, available_pts, list_of_null_factor_names).
    NULL factors are excluded from the denominator.
    Scale: raw 0–10 × weight ÷ 10 → weighted points on same 0–weight scale.
    """
    total = avail = 0.0
    nulls: list[str] = []
    for key, label, weight, _ in FACTOR_DEFS:
        v = scores.get(key)
        if v is None:
            nulls.append(label)
        else:
            total += float(v) * weight / 10.0
            avail += weight
    return total, avail, nulls


# ─── Notion block builder ──────────────────────────────────────────────────────

def _rt(*parts) -> list:
    """
    Build a Notion rich_text array.
    Each part is a str, or a (str, dict) tuple where dict is annotations.
    """
    out = []
    for p in parts:
        if isinstance(p, tuple):
            text, ann = p
            if text:
                out.append({"type": "text", "text": {"content": text}, "annotations": ann})
        elif p:
            out.append({"type": "text", "text": {"content": str(p)}})
    return out


def _h2(text: str) -> dict:
    return {"object": "block", "type": "heading_2", "heading_2": {"rich_text": _rt(text)}}

def _h3(text: str) -> dict:
    return {"object": "block", "type": "heading_3", "heading_3": {"rich_text": _rt(text)}}

def _para(*parts) -> dict:
    return {"object": "block", "type": "paragraph", "paragraph": {"rich_text": _rt(*parts)}}

def _bullet(*parts) -> dict:
    return {"object": "block", "type": "bulleted_list_item",
            "bulleted_list_item": {"rich_text": _rt(*parts)}}

def _divider() -> dict:
    return {"object": "block", "type": "divider", "divider": {}}

def _callout(text: str, emoji: str = "ℹ️") -> dict:
    return {"object": "block", "type": "callout", "callout": {
        "rich_text": _rt(text),
        "icon": {"type": "emoji", "emoji": emoji},
    }}


B = {"bold": True}   # annotation shorthand


def build_notion_blocks(
    ranked:      list[dict],
    unattributed: list[dict],
    incomplete:  list[dict],
    meta:        dict,
) -> list[dict]:
    blocks: list[dict] = []

    # ── Run metadata callout ──
    blocks.append(_callout(
        f"Run: {meta['dt']}  ·  {meta['raw']} snippets pulled  ·  "
        f"{meta['deduped']} after dedup  ·  {meta['n_clusters']} clusters  ·  "
        f"{meta['n_complete']} complete  ·  {meta['n_incomplete']} incomplete",
        "📊",
    ))
    blocks.append(_para(
        "Annex B weights: Operational 20 / Revenue 20 / Market 20 / "
        "Strategic 20 / Urgency 10 / Customer signal 10.  "
        "NULL factors excluded from denominator.  "
        "Sort key: weighted score only.  Effort is never a factor."
    ))

    # ── Ranked clusters ──
    for rank, cluster in enumerate(ranked, 1):
        sc    = cluster["scores"]
        pts   = cluster["pts"]
        avail = cluster["avail"]
        nulls = cluster["nulls"]
        n_snip = sc["_n_snippets"]
        n_acct = sc["_n_accts"]
        churn  = sc["_churn"]
        bet    = sc.get("strategic_bet", "Unaligned")

        score_label = (
            f"{pts:.1f} / {avail:.0f} available pts"
            if avail > 0 else "0 / 0"
        )

        blocks.append(_divider())
        blocks.append(_h3(f"{rank}. {cluster['name']}"))

        blocks.append(_para(
            ("Weighted Score: ", B), score_label,
            "   |   ",
            ("Snippets: ", B),
            f"{n_snip} across {n_acct} distinct account{'s' if n_acct != 1 else ''}",
            "   |   ",
            ("Churn signal: ", B), "Yes" if churn else "No",
        ))

        bet_display = bet if bet.lower() != "unaligned" else "Unaligned — flag for review"
        blocks.append(_para(("Strategic bet alignment: ", B), bet_display))

        if len(nulls) > 1:
            blocks.append(_callout(
                f"Incomplete — human input required.  NULL: {', '.join(nulls)}.  "
                "Sales/Capture → Revenue (F2) and Market (F3).  "
                "Leadership → Urgency (F5).",
                "⚠️",
            ))

        blocks.append(_para(("Factor scores:", B)))
        for key, label, weight, notes_key in FACTOR_DEFS:
            raw   = sc.get(key)
            notes = sc.get(notes_key, "")
            if raw is None:
                raw_s = "NULL"
                w_pts = "—"
            else:
                raw_s = str(int(raw))
                w_pts = f"{raw * weight / 10:.0f}"
            note_part = f"  |  {notes}" if notes else ""
            blocks.append(_bullet(
                (f"{label} (×{weight}): ", B),
                f"raw {raw_s} → {w_pts} pts",
                note_part,
            ))

        reps = sc.get("representative_snippets", [])
        if reps:
            blocks.append(_para(("Representative signal:", B)))
            for r in reps[:3]:
                blocks.append(_bullet(r))

    # ── Unattributed signal ──
    blocks.append(_divider())
    blocks.append(_h2("Unattributed Signal"))
    if unattributed:
        blocks.append(_para(
            f"{len(unattributed)} snippet{'s' if len(unattributed) != 1 else ''} "
            "with no account attribution. Flag for CR intake follow-up."
        ))
        for s in unattributed[:20]:
            blocks.append(_bullet(s.get("content", "")[:250]))
        if len(unattributed) > 20:
            blocks.append(_bullet(f"… and {len(unattributed) - 20} more"))
    else:
        blocks.append(_para("None — all snippets have account attribution."))

    # ── Incomplete clusters ──
    blocks.append(_divider())
    blocks.append(_h2("Incomplete Clusters"))
    if incomplete:
        for c in incomplete:
            blocks.append(_bullet(
                (f"{c['name']}", B),
                f"  — NULL: {', '.join(c['nulls'])}",
            ))
        blocks.append(_para(
            "Sales/Capture owns Factor 2 (Revenue) and Factor 3 (Market opportunity).  "
            "Leadership owns Factor 5 (Urgency)."
        ))
    else:
        blocks.append(_para("None."))

    # ── Run metadata ──
    blocks.append(_divider())
    blocks.append(_h2("Run Metadata"))
    for line in [
        f"Date/time: {meta['dt']}",
        f"Total snippets pulled (across {len(QUERIES)} queries): {meta['raw']}",
        f"Total after deduplication: {meta['deduped']}",
        f"Number of clusters: {meta['n_clusters']}",
        f"Clusters with complete scores: {meta['n_complete']}",
        f"Clusters flagged incomplete (>1 NULL): {meta['n_incomplete']}",
    ]:
        blocks.append(_bullet(line))

    return blocks


# ─── Notion page creation ──────────────────────────────────────────────────────

def create_notion_page(token: str, title: str, blocks: list[dict]) -> str:
    """
    Create a Notion page under PARENT_PAGE_ID.
    Notion API limits children to 100 per request; appends remaining in batches.
    Returns the page URL.
    """
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type":  "application/json",
        "Notion-Version": NOTION_API_VER,
    }
    BATCH = 100

    parent = (
        {"type": "page_id", "page_id": PARENT_PAGE_ID}
        if PARENT_PAGE_ID
        else {"type": "workspace", "workspace": True}
    )
    resp = requests.post(
        f"{NOTION_API_BASE}/pages",
        headers=headers,
        json={
            "parent": parent,
            "properties": {
                "title": {"title": [{"text": {"content": title}}]}
            },
            "children": blocks[:BATCH],
        },
        timeout=30,
    )
    try:
        resp.raise_for_status()
    except requests.HTTPError as exc:
        if resp.status_code == 401:
            print(
                "\nERROR: Notion returned 401 Unauthorized.\n"
                "The Claude Code MCP token may not be compatible with the Notion REST API.\n"
                "Fix: create a Notion integration at https://www.notion.so/my-integrations,\n"
                "share the parent page with it, then re-run with NOTION_TOKEN=<integration_token>.",
                file=sys.stderr,
            )
        raise

    page     = resp.json()
    page_id  = page["id"]
    page_url = page.get("url", f"https://notion.so/{page_id.replace('-', '')}")

    remaining = blocks[BATCH:]
    while remaining:
        batch, remaining = remaining[:BATCH], remaining[BATCH:]
        r = requests.patch(
            f"{NOTION_API_BASE}/blocks/{page_id}/children",
            headers=headers,
            json={"children": batch},
            timeout=30,
        )
        r.raise_for_status()

    return page_url


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    now      = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")
    dt_str   = now.strftime("%Y-%m-%d %H:%M UTC")
    title    = f"Gonkulator Pre-Read — {date_str}"

    print(f"\n{'═' * 62}")
    print(f"  Gonkulator Pre-Read Generator  ·  {dt_str}")
    print(f"{'═' * 62}\n")

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("ERROR: ANTHROPIC_API_KEY environment variable is not set.")

    tokens = load_tokens()
    client = anthropic.Anthropic(api_key=api_key)

    # ── 1. Pull signal ──
    snippets, raw_count = fetch_all_signal(tokens["reforge"])

    # ── 2. Enrich ──
    attributed, unattributed = enrich_snippets(snippets)
    print(f"  Attributed: {len(attributed)}  |  Unattributed: {len(unattributed)}\n")

    # ── 3. Cluster ──
    clusters = cluster_snippets(client, snippets)
    print(f"  → {len(clusters)} clusters identified\n")

    # Build lookup for scoring pass
    by_id = {(s.get("snippetId") or s.get("id")): s for s in snippets}

    # ── 4. Score ──
    print(f"Scoring {len(clusters)} clusters against Gonkulator factors…")
    scored: list[dict] = []
    for c in clusters:
        cluster_snips = [by_id[sid] for sid in c.get("snippet_ids", []) if sid in by_id]
        if not cluster_snips:
            continue
        print(f"  → {c['cluster_name'][:72]}")
        sc           = score_cluster(client, c["cluster_name"], cluster_snips)
        pts, avail, nulls = calc_weighted_score(sc)
        scored.append({
            "name":  c["cluster_name"],
            "scores": sc,
            "pts":   pts,
            "avail": avail,
            "nulls": nulls,
        })

    # ── 5. Rank (weighted score only — no secondary sort) ──
    ranked     = sorted(scored, key=lambda x: x["pts"], reverse=True)
    incomplete = [c for c in ranked if len(c["nulls"]) > 1]
    n_complete = len(ranked) - len(incomplete)

    meta = {
        "dt":          dt_str,
        "raw":         raw_count,
        "deduped":     len(snippets),
        "n_clusters":  len(ranked),
        "n_complete":  n_complete,
        "n_incomplete": len(incomplete),
    }

    # ── 6. Write to Notion ──
    print(f"\nBuilding Notion page: '{title}'…")
    blocks   = build_notion_blocks(ranked, unattributed, incomplete, meta)
    page_url = create_notion_page(tokens["notion"], title, blocks)

    print(f"\n{'═' * 62}")
    print(f"  ✓  {page_url}")
    print(f"     {len(ranked)} clusters  ·  {n_complete} complete  ·  {len(incomplete)} incomplete")
    print(f"{'═' * 62}\n")


if __name__ == "__main__":
    main()
