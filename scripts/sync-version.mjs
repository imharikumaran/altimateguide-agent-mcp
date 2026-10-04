#!/usr/bin/env node
/**
 * Propagate the version from package.json — the single source of truth — into
 * the manifests that must carry it:
 *
 *   server.json        -> version + packages[].version (MCP Registry manifest)
 *   mcpb/manifest.json -> version (Claude Desktop / Smithery bundle manifest)
 *
 * Wired to npm's `version` lifecycle, so `npm version <patch|minor|major>`
 * updates every copy, stages them, and lets npm make the release commit + tag
 * in one step (the checked-in mcpb manifest is what actually ships now that
 * build-mcpb no longer overrides it).
 *
 * Idempotent: run it any time to re-align, or in CI to verify (see
 * test/manifests.test.ts).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function patch(relativePath, update) {
  const file = join(root, relativePath);
  const data = JSON.parse(readFileSync(file, "utf8"));
  const before = JSON.stringify(data);
  update(data);
  if (JSON.stringify(data) === before) {
    console.log(`• ${relativePath} already at ${version}`);
    return;
  }
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  console.log(`• ${relativePath} -> ${version}`);
}

patch("server.json", (data) => {
  data.version = version;
  if (Array.isArray(data.packages)) {
    for (const pkg of data.packages) pkg.version = version;
  }
});

patch("mcpb/manifest.json", (data) => {
  data.version = version;
});
