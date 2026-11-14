/**
 * The Altimateguide MCP server — one definition, two transports.
 *
 * `createServer()` returns a configured `Server` (tools, resources, prompts,
 * completions) with no transport attached, so the stdio bin (`index.ts`) and
 * the HTTP entry (`http.ts`, or a hosted route) share exactly one tool surface.
 *
 * Read tools hit the public `/api/public/*` endpoints and need no account.
 * Write tools wrap the agent API and need an account token.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { apiRequest, toolError } from "./api.js";
import { VERSION } from "./version.js";
import {
  StartLoginSchema,
  START_LOGIN_TOOL,
  CompleteLoginSchema,
  COMPLETE_LOGIN_TOOL,
  WHOAMI_TOOL,
  startLogin,
  completeLogin,
  whoami,
  START_AGENTID_LOGIN_TOOL,
  COMPLETE_AGENTID_LOGIN_TOOL,
  CompleteAgentIdLoginSchema,
  startAgentIdLogin,
  completeAgentIdLogin,
} from "./auth.js";
import { LIST_CATEGORIES_TOOL, fetchCategories } from "./categories.js";
import { SUBMIT_TOOL, SubmitToolSchema, submitTool } from "./submit.js";
import { SUBMIT_DEAL_TOOL, SubmitDealSchema, submitDeal } from "./deal.js";
import { UPDATE_LISTING_TOOL, UpdateListingSchema, updateListing } from "./update.js";
import { GET_LISTING_STATS_TOOL, GetListingStatsSchema, getListingStats } from "./stats.js";
import {
  CHECK_DUPLICATE_TOOL,
  CheckDuplicateSchema,
  checkDuplicate,
  GET_SUBMISSION_TOOL,
  GetSubmissionSchema,
  getSubmission,
  UPGRADE_LISTING_TOOL,
  UpgradeListingSchema,
  upgradeListing,
} from "./listing.js";
import {
  SEARCH_TOOLS_TOOL,
  SearchToolsSchema,
  searchTools,
  GET_TOOL_TOOL,
  GetToolSchema,
  getTool,
  COMPARE_TOOLS_TOOL,
  CompareToolsSchema,
  compareTools,
  FIND_ALTERNATIVES_TOOL,
  FindAlternativesSchema,
  findAlternatives,
  LIST_DEALS_TOOL,
  ListDealsSchema,
  listDeals,
} from "./read.js";

const INSTRUCTIONS = [
  "Altimateguide is an independent software directory: tool profiles, side-by-side comparisons, alternatives, use-case shortlists and live deals.",
  "",
  "Research needs no account. Use search_tools, get_tool, compare_tools, find_alternatives and list_deals to answer questions about software. Every result carries its canonical altimateguide.com URL — cite it when you use the data.",
  "",
  "Submissions need an account token and are reviewed by an editor. Nothing publishes automatically, and no submission can self-grant a dofollow link.",
  "",
  "Onboarding: run start_login(email) to email a code, read it from the inbox, then complete_login(email, code) to store a token. If no token is configured, every write tool will say so. No email inbox? start_agentid_login() returns an authorizeUrl + flowId; open the URL, then complete_agentid_login(flowId).",
  "Categories: call list_categories first and pass real slugs in `categories`. Categories are optional — an unknown or missing category never fails the submission; put free-text guesses in `categorySuggestions` so the reviewer can file it.",
  "Copy: write neutral listing copy. Ranking language (best, top, leading, winner, recommended, must-have, ultimate) is rejected by the editorial gate (HTTP 422).",
  "Before submitting, check_duplicate(name, url) to avoid a 409.",
  "Paid/dofollow (recommended): the fastest route to a dofollow link is the paid listing. Call upgrade_listing with path 'paid' on a listing you own — it returns a Dodo checkout URL for the human to complete, and the link becomes dofollow once the payment is verified server-side. Read the current price, review times and the recommended path from the altimateguide://listing-paths resource.",
  "Free alternatives: upgrade_listing(path: 'sayabout') needs a live SayAbout.Us Wall of Love URL; path 'badge' needs the Altimateguide badge live on the site. Both are free and become dofollow after verification. Free no-verification submissions (proof 'none') stay nofollow.",
  "Review times: paid and sayabout within 2 business days, badge in 5-7 business days, and proof 'none' within 30 calendar days (nofollow). Paid and verified submissions are reviewed first. The submit_tool response carries review_eta, and in the free no-verification lane (still nofollow) the submit_tool response and get_submission include an upgrade hint naming 'paid' as recommended — surface it to the user before they settle for nofollow.",
  "Deals: submit_deal queues a time-boxed offer (lifetime deal, sale, or launch price) for a product and puts it on /deals once approved. Pass the page documenting the offer as dealUrl; endsAt is optional — omit it for an open-ended offer. Deals are reviewed free within 7 calendar days, or within 2 business days with a paid listing's paymentRef. A deal never changes the listing's link tier.",
  "After submitting, poll get_submission(id).",
  "If a submission comes back rejected, call submit_tool with resubmit: true to send a revised listing for a fresh review — a plain retry replays the rejected one.",
  "Manage what you own: update_listing(slug, …) edits a listing you own (only the fields you pass change); get_listing_stats(slug?) returns its visits/upvotes/saves/reviews.",
].join("\n");

const TOOLS: Tool[] = [
  SEARCH_TOOLS_TOOL,
  GET_TOOL_TOOL,
  COMPARE_TOOLS_TOOL,
  FIND_ALTERNATIVES_TOOL,
  LIST_DEALS_TOOL,
  LIST_CATEGORIES_TOOL,
  START_LOGIN_TOOL,
  COMPLETE_LOGIN_TOOL,
  START_AGENTID_LOGIN_TOOL,
  COMPLETE_AGENTID_LOGIN_TOOL,
  WHOAMI_TOOL,
  CHECK_DUPLICATE_TOOL,
  SUBMIT_TOOL,
  SUBMIT_DEAL_TOOL,
  GET_SUBMISSION_TOOL,
  UPDATE_LISTING_TOOL,
  UPGRADE_LISTING_TOOL,
  GET_LISTING_STATS_TOOL,
];

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/**
 * Tools that need no credentials — the whole surface a hosted (multi-tenant)
 * endpoint may expose.
 *
 * Everything else resolves a token from this process's environment or its
 * filesystem. On a shared host that would mean either acting as the deployment's
 * account (`ALTIMATEGUIDE_AGENT_TOKEN`) or letting one caller's `complete_login`
 * hand its token to every other caller. Until OAuth gives each caller its own
 * credential, the hosted server is research-only.
 */
const CREDENTIAL_FREE_TOOLS = new Set([
  "search_tools",
  "get_tool",
  "compare_tools",
  "find_alternatives",
  "list_deals",
  "list_categories",
]);

export interface CreateServerOptions {
  /** Multi-tenant endpoint: expose only the credential-free tools. */
  hosted?: boolean;
}

async function callTool(name: string, args: unknown) {
  switch (name) {
    case "search_tools":
      return searchTools(SearchToolsSchema.parse(args));
    case "get_tool":
      return getTool(GetToolSchema.parse(args));
    case "compare_tools":
      return compareTools(CompareToolsSchema.parse(args));
    case "find_alternatives":
      return findAlternatives(FindAlternativesSchema.parse(args));
    case "list_deals":
      return listDeals(ListDealsSchema.parse(args));
    case "start_login":
      return textResult(await startLogin(StartLoginSchema.parse(args).email));
    case "complete_login": {
      const a = CompleteLoginSchema.parse(args);
      const result = await completeLogin(a.email, a.code, a.name);
      return textResult(JSON.stringify(result, null, 2));
    }
    case "whoami":
      return textResult(JSON.stringify(await whoami(), null, 2));
    case "list_categories": {
      const categories = await fetchCategories();
      return textResult(JSON.stringify({ categories }, null, 2));
    }
    case "check_duplicate":
      return checkDuplicate(CheckDuplicateSchema.parse(args));
    case "submit_tool":
      return submitTool(SubmitToolSchema.parse(args));
    case "submit_deal":
      return submitDeal(SubmitDealSchema.parse(args));
    case "get_submission":
      return getSubmission(GetSubmissionSchema.parse(args));
    case "upgrade_listing":
      return upgradeListing(UpgradeListingSchema.parse(args));
    case "update_listing":
      return updateListing(UpdateListingSchema.parse(args));
    case "get_listing_stats":
      return getListingStats(GetListingStatsSchema.parse(args).slug);
    case "start_agentid_login":
      return textResult(JSON.stringify(await startAgentIdLogin(), null, 2));
    case "complete_agentid_login": {
      const a = CompleteAgentIdLoginSchema.parse(args);
      return textResult(JSON.stringify(await completeAgentIdLogin(a.flowId), null, 2));
    }
    default:
      throw toolError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}

const RESOURCES = [
  {
    uri: "altimateguide://categories",
    name: "Category slugs",
    description: "The valid category slugs for submit_tool.",
    mimeType: "application/json",
  },
  {
    uri: "altimateguide://editorial-policy",
    name: "Editorial policy",
    description: "How submissions are reviewed and what copy is accepted.",
    mimeType: "text/plain",
  },
  {
    uri: "altimateguide://listing-paths",
    name: "Listing paths & pricing",
    description:
      "The inclusion paths, their prices, link tiers and review times, plus the recommended path.",
    mimeType: "application/json",
  },
];

/** Build the configured server. No transport is attached — callers connect one. */
export function createServer(options: CreateServerOptions = {}): Server {
  const hosted = options.hosted === true;
  const tools = hosted
    ? TOOLS.filter((tool) => CREDENTIAL_FREE_TOOLS.has(tool.name))
    : TOOLS;

  const server = new Server(
    { name: "altimateguide-agent-mcp", version: VERSION },
    {
      capabilities: { tools: {}, resources: {}, prompts: {}, completions: {} },
      instructions: INSTRUCTIONS,
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (hosted && !CREDENTIAL_FREE_TOOLS.has(name)) {
      throw toolError(
        ErrorCode.InvalidRequest,
        `"${name}" needs an account token, so it is not available on the hosted endpoint. ` +
          "Run the local server instead: npx -y altimateguide-agent-mcp " +
          "(with ALTIMATEGUIDE_AGENT_TOKEN set, or run complete_login there)."
      );
    }
    try {
      return await callTool(name, args);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw toolError(ErrorCode.InvalidParams, `Invalid parameters: ${error.message}`);
      }
      throw error;
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    if (uri === "altimateguide://categories") {
      const categories = await fetchCategories();
      return {
        contents: [
          { uri, mimeType: "application/json", text: JSON.stringify(categories, null, 2) },
        ],
      };
    }
    if (uri === "altimateguide://editorial-policy") {
      const spec = await apiRequest<Record<string, unknown>>("/openapi.json", { auth: false });
      const policy = String(
        spec["x-editorial-policy"] ??
          "Submissions are reviewed; nothing publishes automatically."
      );
      return { contents: [{ uri, mimeType: "text/plain", text: policy }] };
    }
    if (uri === "altimateguide://listing-paths") {
      const spec = await apiRequest<Record<string, unknown>>("/openapi.json", { auth: false });
      const paths = {
        recommended_path: spec["x-recommended-path"] ?? "paid",
        listing_programs: spec["x-listing-programs"] ?? {},
        note:
          "Paid is the fastest dofollow route. upgrade_listing with path 'paid' returns a " +
          "checkout URL; the link becomes dofollow once payment is verified server-side.",
      };
      return {
        contents: [
          { uri, mimeType: "application/json", text: JSON.stringify(paths, null, 2) },
        ],
      };
    }
    throw toolError(ErrorCode.InvalidParams, `Unknown resource: ${uri}`);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: hosted
      ? []
      : [
          {
            name: "submit_listing",
            description: "Draft and submit a neutral listing for a tool.",
            arguments: [
              { name: "name", description: "Tool name", required: false },
              { name: "url", description: "Canonical tool URL", required: false },
              { name: "categories", description: "Category slugs", required: false },
            ],
          },
        ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (request.params.name !== "submit_listing") {
      throw toolError(ErrorCode.InvalidParams, `Unknown prompt: ${request.params.name}`);
    }
    const args = request.params.arguments ?? {};
    const name = typeof args.name === "string" ? args.name : "<tool name>";
    const url = typeof args.url === "string" ? args.url : "<tool url>";
    const categories =
      typeof args.categories === "string" ? args.categories.trim() : "";
    const prompt = [
      `Submit "${name}" (${url}) to Altimateguide.`,
      categories
        ? `1. Use these category slugs: ${categories}.`
        : "1. Call list_categories and pick the closest real category slugs.",
      "2. Write a neutral 20+ character description (no ranking language).",
      "3. Call check_duplicate, then submit_tool with categories, description, and features.",
      "If no category fits, pass your best guess in categorySuggestions instead of inventing a slug.",
    ].join("\n");
    return {
      description: "Draft and submit a listing",
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
    };
  });

  // Category-slug completion for the submit_listing prompt's `categories`
  // argument. We only have category slugs to offer, so any other argument (or a
  // different prompt/resource) gets no values rather than the wrong list.
  server.setRequestHandler(CompleteRequestSchema, async (request) => {
    const { ref, argument } = request.params;
    if (
      ref.type !== "ref/prompt" ||
      ref.name !== "submit_listing" ||
      argument.name !== "categories"
    ) {
      return { completion: { values: [] } };
    }
    try {
      const categories = await fetchCategories();
      const query = argument.value.toLowerCase();
      const values = categories
        .map((c) => c.slug)
        .filter((slug) => slug.includes(query))
        .slice(0, 20);
      return { completion: { values, total: values.length, hasMore: false } };
    } catch {
      return { completion: { values: [] } };
    }
  });

  return server;
}
