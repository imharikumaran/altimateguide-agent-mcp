/** The package version, read from package.json (works from src/ and dist/). */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION: string = (() => {
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
})();
