/**
 * Public read tools — the research half of the server.
 *
 * These wrap the anonymous `/api/public/*` endpoints on altimateguide.com and
 * never send a bearer token, so they work with no account at all. Everything
 * they return is directory data: tool profiles, comparisons, alternatives and
 * live deals — the same pages a person would browse on the site.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { apiRequest } from "./api.js";
import { inputSchemaFor } from "./schema.js";

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, value);
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

// ---------------------------------------------------------------- search_tools

export const SearchToolsSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .optional()
      .describe("Free-text query matched against name, definition and value proposition"),
    category: z
      .string()
      .min(1)
      .optional()
      .describe("Category slug — call list_categories for the valid set"),
    freePlan: z.boolean().optional().describe("Only tools with a free plan"),
    limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
  })
  .strict();

export type SearchToolsArgs = z.infer<typeof SearchToolsSchema>;

export const SEARCH_TOOLS_TOOL: Tool = {
  name: "search_tools",
  description:
    "Search the Altimateguide directory (no token needed). Returns matching tools with " +
    "definition, categories, starting price, free plan/trial and their canonical page URL. " +
    "Use category slugs from list_categories to narrow it.",
  inputSchema: inputSchemaFor(SearchToolsSchema),
  annotations: { title: "Search tools", readOnlyHint: true, openWorldHint: true },
};

export async function searchTools(args: SearchToolsArgs) {
  const data = await apiRequest(
    withQuery("/api/public/search", {
      q: args.query,
      category: args.category,
      free_plan: args.freePlan ? "1" : undefined,
      limit: args.limit === undefined ? undefined : String(args.limit),
    }),
    { auth: false }
  );
  return jsonResult(data);
}

// ------------------------------------------------------------------- get_tool

export const GetToolSchema = z
  .object({
    slug: z.string().min(1).describe('Tool slug (e.g. "posthog", "calendly")'),
  })
  .strict();

export type GetToolArgs = z.infer<typeof GetToolSchema>;

export const GET_TOOL_TOOL: Tool = {
  name: "get_tool",
  description:
    "Read one tool's full directory profile (no token needed): definition, value proposition, " +
    "categories, starting price, free plan/trial, pros, cons, features, rating and vote counts, " +
    "and its canonical page URL on altimateguide.com.",
  inputSchema: inputSchemaFor(GetToolSchema),
  annotations: { title: "Get a tool profile", readOnlyHint: true, openWorldHint: true },
};

export async function getTool(args: GetToolArgs) {
  const data = await apiRequest(`/api/public/tools/${encodeURIComponent(args.slug)}`, {
    auth: false,
  });
  return jsonResult(data);
}

// --------------------------------------------------------------- compare_tools

export const CompareToolsSchema = z
  .object({
    toolA: z.string().min(1).describe("First tool slug"),
    toolB: z.string().min(1).describe("Second tool slug"),
  })
  .strict();

export type CompareToolsArgs = z.infer<typeof CompareToolsSchema>;

export const COMPARE_TOOLS_TOOL: Tool = {
  name: "compare_tools",
  description:
    "Compare two tools side by side (no token needed). Returns both profiles, the aligned " +
    "pricing/free-plan features, and the canonical /vs/<a>-vs-<b> page when one exists, so the " +
    "answer can cite altimateguide.com.",
  inputSchema: inputSchemaFor(CompareToolsSchema),
  annotations: { title: "Compare two tools", readOnlyHint: true, openWorldHint: true },
};

export async function compareTools(args: CompareToolsArgs) {
  const data = await apiRequest(
    withQuery("/api/public/compare", { a: args.toolA, b: args.toolB }),
    { auth: false }
  );
  return jsonResult(data);
}

// ----------------------------------------------------------- find_alternatives

export const FindAlternativesSchema = z
  .object({
    slug: z.string().min(1).describe("The tool to find alternatives for"),
    limit: z.number().int().min(1).max(20).optional().describe("Max alternatives (default 5)"),
  })
  .strict();

export type FindAlternativesArgs = z.infer<typeof FindAlternativesSchema>;

export const FIND_ALTERNATIVES_TOOL: Tool = {
  name: "find_alternatives",
  description:
    "Find alternatives to a tool (no token needed): the curated alternatives page when one " +
    "exists, plus same-category tools ranked by engagement. Returns their canonical URLs.",
  inputSchema: inputSchemaFor(FindAlternativesSchema),
  annotations: { title: "Find alternatives", readOnlyHint: true, openWorldHint: true },
};

export async function findAlternatives(args: FindAlternativesArgs) {
  const data = await apiRequest(
    withQuery(`/api/public/alternatives/${encodeURIComponent(args.slug)}`, {
      limit: args.limit === undefined ? undefined : String(args.limit),
    }),
    { auth: false }
  );
  return jsonResult(data);
}

// ------------------------------------------------------------------ list_deals

export const ListDealsSchema = z
  .object({
    kind: z
      .enum(["ltd", "sale", "launch"])
      .optional()
      .describe("ltd = lifetime deal, sale = discount, launch = launch price"),
    limit: z.number().int().min(1).max(100).optional().describe("Max deals (default 20)"),
  })
  .strict();

export type ListDealsArgs = z.infer<typeof ListDealsSchema>;

export const LIST_DEALS_TOOL: Tool = {
  name: "list_deals",
  description:
    "List live time-boxed deals (no token needed) — lifetime deals, sales and launch offers — " +
    "with price, pre-deal price, end date and the deal page URL.",
  inputSchema: inputSchemaFor(ListDealsSchema),
  annotations: { title: "List live deals", readOnlyHint: true, openWorldHint: true },
};

export async function listDeals(args: ListDealsArgs) {
  const data = await apiRequest(
    withQuery("/api/public/deals", {
      kind: args.kind,
      limit: args.limit === undefined ? undefined : String(args.limit),
    }),
    { auth: false }
  );
  return jsonResult(data);
}
