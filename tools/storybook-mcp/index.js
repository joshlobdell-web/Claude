#!/usr/bin/env node
/**
 * Storybook MCP Server for ods.onebrief.com
 *
 * Set STORYBOOK_BASE_URL and STORYBOOK_SESSION_COOKIE env vars before running.
 * The session cookie can be copied from DevTools → Application → Cookies.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.STORYBOOK_BASE_URL || "https://ods.onebrief.com").replace(/\/$/, "");
const SESSION_COOKIE = process.env.STORYBOOK_SESSION_COOKIE || "";

const server = new McpServer({
  name: "storybook-ods",
  version: "1.0.0",
});

// ── helpers ────────────────────────────────────────────────────────────────

function buildHeaders() {
  const headers = { "Accept": "application/json" };
  if (SESSION_COOKIE) headers["Cookie"] = SESSION_COOKIE;
  return headers;
}

async function fetchJson(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: buildHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${path}`);
  return res.json();
}

async function fetchText(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { ...buildHeaders(), Accept: "text/html,text/plain,*/*" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${path}`);
  return res.text();
}

// Load the Storybook index (tries v7 index.json then v6 stories.json)
async function loadIndex() {
  try {
    return await fetchJson("/index.json");
  } catch {
    return await fetchJson("/stories.json");
  }
}

// Build a component tree from the flat Storybook entry index
function buildComponentTree(index) {
  const entries = index.entries || index.stories || {};
  const tree = {};

  for (const [id, entry] of Object.entries(entries)) {
    const title = entry.title || id;
    const parts = title.split("/");
    const category = parts.length > 1 ? parts[0] : "Uncategorized";
    const component = parts.length > 1 ? parts.slice(1).join("/") : parts[0];

    if (!tree[category]) tree[category] = {};
    if (!tree[category][component]) tree[category][component] = [];
    tree[category][component].push({
      id,
      name: entry.name,
      type: entry.type || "story",
      tags: entry.tags || [],
    });
  }

  return tree;
}

// ── tools ──────────────────────────────────────────────────────────────────

server.tool(
  "list_components",
  "List all components in the Onebrief Design System (ODS) Storybook, organised by category",
  {},
  async () => {
    const index = await loadIndex();
    const tree = buildComponentTree(index);
    const lines = [];

    for (const [category, components] of Object.entries(tree).sort()) {
      lines.push(`\n## ${category}`);
      for (const [component, stories] of Object.entries(components).sort()) {
        const storyNames = stories.map((s) => s.name).join(", ");
        lines.push(`  • ${component}  [${storyNames}]`);
      }
    }

    return {
      content: [{ type: "text", text: `# ODS Component Library\n${lines.join("\n")}` }],
    };
  }
);

server.tool(
  "get_component",
  "Get all stories and metadata for a specific ODS component by name (e.g. 'Button', 'Input', 'Modal')",
  { name: z.string().describe("Component name to look up, e.g. 'Button' or 'Forms/Input'") },
  async ({ name }) => {
    const index = await loadIndex();
    const entries = index.entries || index.stories || {};
    const query = name.toLowerCase();

    const matches = Object.values(entries).filter((e) =>
      (e.title || "").toLowerCase().includes(query)
    );

    if (!matches.length) {
      return { content: [{ type: "text", text: `No component found matching "${name}"` }] };
    }

    const lines = matches.map((e) =>
      `- **${e.title} / ${e.name}** (id: \`${e.id}\`, type: ${e.type || "story"}, tags: ${(e.tags || []).join(", ") || "none"})`
    );

    return {
      content: [{ type: "text", text: `## ${name}\n\n${lines.join("\n")}` }],
    };
  }
);

server.tool(
  "search_components",
  "Search ODS components by name or tag",
  {
    query: z.string().describe("Search term — matches against component title, story name, or tags"),
  },
  async ({ query }) => {
    const index = await loadIndex();
    const entries = index.entries || index.stories || {};
    const q = query.toLowerCase();

    const matches = Object.values(entries).filter((e) => {
      const title = (e.title || "").toLowerCase();
      const name = (e.name || "").toLowerCase();
      const tags = (e.tags || []).join(" ").toLowerCase();
      return title.includes(q) || name.includes(q) || tags.includes(q);
    });

    if (!matches.length) {
      return { content: [{ type: "text", text: `No results for "${query}"` }] };
    }

    const lines = matches.map((e) => `- \`${e.id}\` — **${e.title} / ${e.name}**`);
    return {
      content: [{ type: "text", text: `## Search: "${query}" (${matches.length} results)\n\n${lines.join("\n")}` }],
    };
  }
);

server.tool(
  "get_story_docs",
  "Fetch the rendered HTML docs page for a specific story ID (e.g. 'button--primary')",
  { storyId: z.string().describe("Story ID from list_components or search_components, e.g. 'button--primary'") },
  async ({ storyId }) => {
    const html = await fetchText(`/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=docs`);
    // Strip script/style tags for readability
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 8000);

    return { content: [{ type: "text", text: text }] };
  }
);

server.tool(
  "check_connection",
  "Test whether the Storybook is reachable and the session cookie is valid",
  {},
  async () => {
    try {
      const index = await loadIndex();
      const entries = index.entries || index.stories || {};
      const count = Object.keys(entries).length;
      return {
        content: [{ type: "text", text: `Connected to ${BASE_URL}\nStorybook version key: ${index.v || "unknown"}\nTotal stories indexed: ${count}` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Connection failed: ${err.message}\n\nMake sure STORYBOOK_SESSION_COOKIE is set correctly.` }],
      };
    }
  }
);

// ── start ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
