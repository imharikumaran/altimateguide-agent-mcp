/** Derive a tool's JSON Schema from its zod validator (one source of truth). */
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export function inputSchemaFor(schema: z.ZodTypeAny): Tool["inputSchema"] {
  const json = zodToJsonSchema(schema, { target: "jsonSchema7" }) as Record<string, unknown>;
  delete json.$schema;
  return json as Tool["inputSchema"];
}
