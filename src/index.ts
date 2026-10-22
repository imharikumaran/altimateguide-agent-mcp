#!/usr/bin/env node

/**
 * Altimateguide agent MCP server (stdio transport).
 *
 * Wraps the public Altimateguide agent API (no database access): an agent can
 * log in (email OTP -> token), discover categories, preflight duplicates,
 * submit a listing, poll its status, and choose how it earns a dofollow link
 * (including the paid checkout). Nothing is published without editorial review,
 * and a paid listing is only a dofollow candidate once its payment is verified
 * server-side.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

const INSTRUCTIONS = [
  "Altimateguide lets you submit a software tool to an independent directory for editorial review.",
  "Nothing publishes automatically, and no submission can self-grant a dofollow link.",
  "",
  "Onboarding: run start_login(email) to email a code, read it from the inbox, then complete_login(email, code) to store a token. If no token is configured, every tool will say so.",
  "Categories: call list_categories first and pass real slugs in `categories`. Categories are optional — an unknown or missing category never fails the submission; put free-text guesses in `categorySuggestions` so the reviewer can file it.",
  "Copy: write neutral listing copy. Ranking language (best, top, leading, winner, recommended, must-have, ultimate) is rejected by the editorial gate (HTTP 422).",
  "Before submitting, check_duplicate(name, url) to avoid a 409.",
  "Paid/dofollow: submit_tool does standard (nofollow) listings; use upgrade_listing with path 'sayabout' | 'badge' | 'paid' on a listing you own. 'paid' returns a Dodo checkout URL; the link only becomes dofollow once the payment is verified server-side.",
  "Review times: paid and sayabout are reviewed within 2 business days, badge in 5-7 business days, and proof 'none' in 15-20 business days (nofollow). Verified and paid submissions are reviewed first. The submit_tool response carries review_eta, and an unverified response includes an upgrade hint — tell the user this before they pick a proof, since sayabout is free.",
  "After submitting, poll get_submission(id).",
  "If a submission comes back rejected, call submit_tool with resubmit: true to send a revised listing for a fresh review — a plain retry replays the rejected one.",
  "Manage what you own: update_listing(slug, …) edits a listing you own (only the fields you pass change); get_listing_stats(slug?) returns its visits/upvotes/saves/reviews.",
  "No email inbox? start_agentid_login() returns an authorizeUrl + flowId; open the URL to complete the sign-in, then complete_agentid_login(flowId) stores the account token.",
].join("\n");

const TOOLS: Tool[] = [
  START_LOGIN_TOOL,
  COMPLETE_LOGIN_TOOL,
  START_AGENTID_LOGIN_TOOL,
  COMPLETE_AGENTID_LOGIN_TOOL,
  WHOAMI_TOOL,
  LIST_CATEGORIES_TOOL,
  CHECK_DUPLICATE_TOOL,
  SUBMIT_TOOL,
  GET_SUBMISSION_TOOL,
  UPDATE_LISTING_TOOL,
  UPGRADE_LISTING_TOOL,
  GET_LISTING_STATS_TOOL,
];

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

async function callTool(name: string, args: unknown) {
  switch (name) {
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
];

const server = new Server(
  { name: "altimateguide-agent-mcp", version: VERSION },
  {
    capabilities: { tools: {}, resources: {}, prompts: {}, completions: {} },
    instructions: INSTRUCTIONS,
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
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
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify(categories, null, 2) }],
    };
  }
  if (uri === "altimateguide://editorial-policy") {
    const spec = await apiRequest<Record<string, unknown>>("/openapi.json", { auth: false });
    const policy = String(spec["x-editorial-policy"] ?? "Submissions are reviewed; nothing publishes automatically.");
    return { contents: [{ uri, mimeType: "text/plain", text: policy }] };
  }
  throw toolError(ErrorCode.InvalidParams, `Unknown resource: ${uri}`);
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
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

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Altimateguide agent MCP server running (tools, resources, prompts).");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
