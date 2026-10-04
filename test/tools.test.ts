import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearToken, getToken, saveToken, tokenPreview } from "../src/credentials";
import { rankCategories } from "../src/categories";
import { checkDuplicate, getSubmission, upgradeListing } from "../src/listing";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of [
    "ALTIMATEGUIDE_AGENT_TOKEN",
    "ALTIMATEGUIDE_API_URL",
    "ALTIMATEGUIDE_CONFIG_DIR",
  ]) {
    savedEnv[key] = process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("credentials", () => {
  it("round-trips a stored token and clears it", () => {
    const dir = mkdtempSync(join(tmpdir(), "atg-"));
    try {
      process.env.ALTIMATEGUIDE_CONFIG_DIR = dir;
      delete process.env.ALTIMATEGUIDE_AGENT_TOKEN;

      expect(getToken()).toBeUndefined();
      saveToken("atg_stored_token_123456");
      expect(getToken()).toBe("atg_stored_token_123456");
      expect(tokenPreview()).toBe("atg_stor…3456");

      clearToken();
      expect(getToken()).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers the environment variable over the stored token", () => {
    process.env.ALTIMATEGUIDE_CONFIG_DIR = "/nonexistent-altimateguide-test";
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_from_env";
    expect(getToken()).toBe("atg_from_env");
  });
});

describe("rankCategories", () => {
  const categories = [
    { slug: "ai-tools", title: "AI Tools" },
    { slug: "writing-tools", title: "Writing Tools" },
    { slug: "scheduling-tools", title: "Scheduling Tools" },
  ];

  it("matches the most specific slug and drops non-matches", () => {
    expect(rankCategories("writing", categories).map((c) => c.slug)).toEqual([
      "writing-tools",
    ]);
    expect(rankCategories("ai", categories).map((c) => c.slug)).toEqual(["ai-tools"]);
  });

  it("returns nothing when no category matches", () => {
    expect(rankCategories("blockchain", categories)).toEqual([]);
  });

  it("returns everything for an empty query", () => {
    expect(rankCategories("", categories)).toHaveLength(3);
  });
});

describe("checkDuplicate", () => {
  it("queries the check endpoint with a bearer token", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ duplicate: false }));
    vi.stubGlobal("fetch", fetchMock);

    await checkDuplicate({ name: "Acme", url: "https://acme.com" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/agent/check?");
    expect(String(url)).toContain("name=Acme");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer atg_test");
  });
});

describe("getSubmission", () => {
  it("reads the submission status endpoint", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 7, status: "pending" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSubmission({ id: 7 });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://altimateguide.com/api/agent/submissions/7"
    );
    expect(result.structuredContent).toEqual({ id: 7, status: "pending" });
  });
});

describe("upgradeListing", () => {
  it("posts the chosen path", async () => {
    process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, checkoutUrl: "https://pay" }));
    vi.stubGlobal("fetch", fetchMock);

    await upgradeListing({ path: "paid", submissionId: 12 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://altimateguide.com/api/agent/listing");
    expect(JSON.parse(String(init?.body))).toEqual({ path: "paid", submissionId: 12 });
  });
});
