import { resolveContainedCommand } from "../core/toolchain.ts";
export async function detectCodeTree() {
  const resolved = await resolveContainedCommand("codetree");
  return {
    name: "codetree",
    available: resolved.contained,
    path: resolved.contained ? resolved.command : undefined,
    reason: resolved.contained ? undefined : resolved.reason,
    capabilities: ["tree-sitter-structure", "mcp-jsonrpc", "repository-map", "symbol-search", "dataflow"]
  };
}
