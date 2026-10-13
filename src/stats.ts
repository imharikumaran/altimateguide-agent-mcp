/**
 * `get_listing_stats` — engagement analytics for the listings you own.
 *
 * Wraps GET /api/agent/stats: visits, upvotes, saves and reviews with lifetime
 * totals plus 7/30-day windows. Omit `slug` for every listing the account owns.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { apiRequest } from "./api.js";
import { inputSchemaFor } from "./schema.js";

export const GetListingStatsSchema = z.object({
  slug: z
    .string()
    .optional()
    .describe("Limit to a single listing you own; omit to return every listing"),
});

export const GET_LISTING_STATS_TOOL: Tool = {
  name: "get_listing_stats",
  description:
    "Get visits, upvotes, saves and reviews (lifetime totals plus 7- and 30-day windows) " +
    "for the listings you own (GET /api/agent/stats). Omit slug to get them all.",
  inputSchema: inputSchemaFor(GetListingStatsSchema),
  annotations: { title: "Get listing stats", readOnlyHint: true, openWorldHint: true },
};

export async function getListingStats(slug?: string) {
  const query = slug ? `?slug=${encodeURIComponent(slug)}` : "";
  const data = await apiRequest<Record<string, unknown>>(`/api/agent/stats${query}`);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}
