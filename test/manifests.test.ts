import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson<T>(relativePath: string): T {
    return JSON.parse(readFileSync(join(root, relativePath), "utf8")) as T;
}

describe("manifest version sync", () => {
    it("keeps package.json, server.json and mcpb/manifest.json in agreement", () => {
        const pkg = readJson<{ version: string }>("package.json");
        const server = readJson<{ version: string; packages: { version: string }[] }>("server.json");
        const mcpb = readJson<{ version: string }>("mcpb/manifest.json");

        expect(server.version).toBe(pkg.version);
        expect(server.packages[0].version).toBe(pkg.version);
        expect(mcpb.version).toBe(pkg.version);
    });
});
