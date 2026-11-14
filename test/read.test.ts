import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  SearchToolsSchema,
  GetToolSchema,
  CompareToolsSchema,
  FindAlternativesSchema,
  ListDealsSchema,
  searchTools,
  getTool,
  compareTools,
  findAlternatives,
  listDeals,
} from "../src/read";
import { createServer } from "../src/server";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ["ALTIMATEGUIDE_AGENT_TOKEN", "ALTIMATEGUIDE_API_URL"]) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.ALTIMATEGUIDE_API_URL = "https://altimateguide.com";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("read tools need no token", () => {
  it("search_tools sends no Authorization header and builds the query", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchTools(SearchToolsSchema.parse({ query: "analytics", freePlan: true }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://altimateguide.com/api/public/search?q=analytics&free_plan=1"
    );
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("get_tool reads the public profile endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ slug: "posthog", name: "PostHog" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTool(GetToolSchema.parse({ slug: "posthog" }));

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://altimateguide.com/api/public/tools/posthog"
    );
    expect(result.structuredContent).toEqual({ slug: "posthog", name: "PostHog" });
  });

  it("compare_tools passes both slugs", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ url: "/vs/a-vs-b" }));
    vi.stubGlobal("fetch", fetchMock);

    await compareTools(CompareToolsSchema.parse({ toolA: "a", toolB: "b" }));

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://altimateguide.com/api/public/compare?a=a&b=b"
    );
  });

  it("find_alternatives URIs encode the slug and carry limit", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ alternatives: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await findAlternatives(FindAlternativesSchema.parse({ slug: "calendly", limit: 3 }));

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://altimateguide.com/api/public/alternatives/calendly?limit=3"
    );
  });

  it("list_deals filters by kind", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ deals: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listDeals(ListDealsSchema.parse({ kind: "ltd" }));

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://altimateguide.com/api/public/deals?kind=ltd"
    );
  });
});

describe("server surface", () => {
  it("advertises the read tools alongside the write tools", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    const server = createServer();

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "search_tools",
        "get_tool",
        "compare_tools",
        "find_alternatives",
        "list_deals",
        "list_categories",
        "submit_tool",
        "upgrade_listing",
      ])
    );

    const search = tools.find((tool) => tool.name === "search_tools");
    expect(search?.annotations?.readOnlyHint).toBe(true);

    await client.close();
    await server.close();
  });

  it("a hosted server exposes only credential-free tools", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    const server = createServer({ hosted: true });

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        "compare_tools",
        "find_alternatives",
        "get_tool",
        "list_categories",
        "list_deals",
        "search_tools",
      ].sort()
    );

    const { prompts } = await client.listPrompts();
    expect(prompts).toEqual([]);

    await expect(
      client.callTool({ name: "submit_deal", arguments: { name: "x", url: "https://x.dev" } })
    ).rejects.toThrow(/needs an account token/);

    await client.close();
    await server.close();
  });
});
