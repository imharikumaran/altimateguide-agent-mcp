#!/usr/bin/env node
/**
 * Build a .mcpb (MCP Bundle) for Smithery / Claude Desktop.
 *
 * Assembles a self-contained staging directory — manifest.json, the compiled
 * server, and production node_modules — then packs it with @anthropic-ai/mcpb.
 *
 *   npm run bundle   ->   build/altimateguide-agent-mcp-<version>.mcpb
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "mcpb", "manifest.json"), "utf8"));

const stage = join(root, "build", "mcpb");
const out = join(root, "build", `${pkg.name}-${pkg.version}.mcpb`);

// npm run exports npm_config_* into our env; a nested project install rejects
// the inherited allow-scripts setting, so strip it before shelling out.
const childEnv = { ...process.env };
delete childEnv.npm_config_allow_scripts;
delete childEnv.NPM_CONFIG_ALLOW_SCRIPTS;

// 1. compile the server
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit", env: childEnv });

// 2. assemble the bundle root
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "server"), { recursive: true });
cpSync(join(root, "dist", "index.js"), join(stage, "server", "index.js"));
// The checked-in manifest is the source (kept in sync with package.json by
// scripts/sync-version.mjs on `npm version`), so bundle it verbatim rather than
// patching the version here — that masking is what let it drift before.
writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      type: "module",
      dependencies: pkg.dependencies,
    },
    null,
    2
  ) + "\n"
);

// 3. bundle production dependencies
execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: stage,
  stdio: "inherit",
  env: childEnv,
});

// 4. pack into a .mcpb
execFileSync("npx", ["-y", "@anthropic-ai/mcpb", "pack", stage, out], {
  cwd: root,
  stdio: "inherit",
  env: childEnv,
});

console.log(`\n✅ Built ${out}`);
