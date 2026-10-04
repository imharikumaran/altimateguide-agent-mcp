/**
 * Category discovery + matching.
 *
 * Categories come from the site (single source of truth) at call time. When an
 * agent only has a loose phrase ("ai writing assistant") we rank the real slugs
 * against it so the agent can pick a valid one — and if nothing fits it can
 * still submit, with the guess going into categorySuggestions.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { apiRequest } from "./api.js";

export interface Category {
  slug: string;
  title: string;
}

export const LIST_CATEGORIES_TOOL: Tool = {
  name: "list_categories",
  description:
    "List the valid category slugs (GET /api/agent/categories). Use these in submit_tool; " +
    "anything that doesn't match goes in categorySuggestions.",
  inputSchema: { type: "object", properties: {} },
  annotations: { title: "List categories", readOnlyHint: true, openWorldHint: true },
};

/** Fetch the valid category slugs from the API (public). */
export async function fetchCategories(): Promise<Category[]> {
  const data = await apiRequest<{ categories?: Category[] }>("/api/agent/categories", {
    auth: false,
  });
  return Array.isArray(data.categories) ? data.categories : [];
}

/** Rank categories against a free-text query by slug/title token overlap. */
export function rankCategories(query: string, categories: Category[]): Category[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.length === 0) return categories;

  return categories
    .map((category) => {
      const haystack = `${category.slug} ${category.title}`.toLowerCase();
      const score = tokens.reduce(
        (sum, token) => (haystack.includes(token) ? sum + token.length : sum),
        0
      );
      return { category, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.category);
}
