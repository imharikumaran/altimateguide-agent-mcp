import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiBase, SUBMIT_TOOL, SubmitToolSchema, submitTool } from "../src/submit";

const baseArgs = {
    name: "Example Tool",
    url: "https://example.com/tool",
    categories: ["productivity"],
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

let originalToken: string | undefined;
let originalBase: string | undefined;

beforeEach(() => {
    originalToken = process.env.ALTIMATEGUIDE_AGENT_TOKEN;
    originalBase = process.env.ALTIMATEGUIDE_API_URL;
});

afterEach(() => {
    vi.unstubAllGlobals();
    if (originalToken === undefined) delete process.env.ALTIMATEGUIDE_AGENT_TOKEN;
    else process.env.ALTIMATEGUIDE_AGENT_TOKEN = originalToken;
    if (originalBase === undefined) delete process.env.ALTIMATEGUIDE_API_URL;
    else process.env.ALTIMATEGUIDE_API_URL = originalBase;
});

describe("apiBase", () => {
    it("defaults to the production API", () => {
        delete process.env.ALTIMATEGUIDE_API_URL;
        expect(apiBase()).toBe("https://altimateguide.com");
    });

    it("trims trailing slashes from an override", () => {
        process.env.ALTIMATEGUIDE_API_URL = "https://staging.example.com///";
        expect(apiBase()).toBe("https://staging.example.com");
    });
});

describe("submitTool", () => {
    it("posts a snake_case payload with a bearer token", async () => {
        process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
        const fetchMock = vi.fn<typeof fetch>();
        fetchMock.mockResolvedValueOnce(jsonResponse({ submission_id: "s1", status: "pending" }));
        vi.stubGlobal("fetch", fetchMock);

        const result = await submitTool(
            SubmitToolSchema.parse({
                ...baseArgs,
                description: "A perfectly neutral description of the tool.",
                features: [{ label: "Fast" }],
                proof: "sayabout",
                verificationUrl: "https://example.com/review",
                externalId: "ext-1",
            })
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://altimateguide.com/api/agent/submit");
        expect(init?.method).toBe("POST");
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer atg_test");

        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
            source: "agent:mcp",
            external_id: "ext-1",
            proof: "sayabout",
            verification_url: "https://example.com/review",
            listing: {
                name: "Example Tool",
                url: "https://example.com/tool",
                description: "A perfectly neutral description of the tool.",
                categories: ["productivity"],
                features: [{ label: "Fast" }],
            },
        });
        expect(body).not.toHaveProperty("externalId");

        expect(result.content[0].type).toBe("text");
        expect(JSON.parse(result.content[0].text)).toEqual({
            submission_id: "s1",
            status: "pending",
        });
    });

    it("defaults the proof to none", async () => {
        process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
        const fetchMock = vi.fn<typeof fetch>();
        fetchMock.mockResolvedValueOnce(jsonResponse({ status: "pending" }));
        vi.stubGlobal("fetch", fetchMock);

        await submitTool(SubmitToolSchema.parse(baseArgs));

        const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(body.proof).toBe("none");
    });

    it("fails fast, without calling the API, when the token is missing", async () => {
        delete process.env.ALTIMATEGUIDE_AGENT_TOKEN;
        const fetchMock = vi.fn<typeof fetch>();
        vi.stubGlobal("fetch", fetchMock);

        await expect(submitTool(SubmitToolSchema.parse(baseArgs))).rejects.toMatchObject({
            code: ErrorCode.InvalidRequest,
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("maps API errors to invalid request errors", async () => {
        process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
        const fetchMock = vi.fn<typeof fetch>();
        fetchMock.mockResolvedValueOnce(jsonResponse({ error: "duplicate submission" }, 409));
        vi.stubGlobal("fetch", fetchMock);

        await expect(submitTool(SubmitToolSchema.parse(baseArgs))).rejects.toMatchObject({
            code: ErrorCode.InvalidRequest,
            message: expect.stringContaining("409"),
        });
    });

    it("maps network failures to internal errors", async () => {
        process.env.ALTIMATEGUIDE_AGENT_TOKEN = "atg_test";
        const fetchMock = vi.fn<typeof fetch>();
        fetchMock.mockRejectedValueOnce(new Error("connection refused"));
        vi.stubGlobal("fetch", fetchMock);

        await expect(submitTool(SubmitToolSchema.parse(baseArgs))).rejects.toMatchObject({
            code: ErrorCode.InternalError,
            message: expect.stringContaining("connection refused"),
        });
    });
});

describe("SubmitToolSchema", () => {
    it("requires a non-empty category list", () => {
        expect(SubmitToolSchema.safeParse({ ...baseArgs, categories: [] }).success).toBe(false);
    });

    it("rejects a description shorter than 20 characters", () => {
        expect(SubmitToolSchema.safeParse({ ...baseArgs, description: "too short" }).success).toBe(
            false
        );
    });

    it("rejects a non-URL", () => {
        expect(SubmitToolSchema.safeParse({ ...baseArgs, url: "not-a-url" }).success).toBe(false);
    });

    it("rejects a malformed source id", () => {
        expect(SubmitToolSchema.safeParse({ ...baseArgs, source: "Agent MCP" }).success).toBe(false);
    });
});

interface JsonSchema {
    type?: string;
    required?: string[];
    properties?: Record<string, { minLength?: number; enum?: string[] }>;
}

describe("SUBMIT_TOOL input schema", () => {
    it("is derived from the Zod schema", () => {
        const schema = SUBMIT_TOOL.inputSchema as unknown as JsonSchema;
        expect(schema.type).toBe("object");
        expect(schema.required).toEqual(expect.arrayContaining(["name", "url", "categories"]));
        expect(schema.properties?.description?.minLength).toBe(20);
        expect(schema.properties?.proof?.enum).toEqual(["none", "sayabout", "badge", "paid"]);
        expect(schema).not.toHaveProperty("$schema");
    });
});
