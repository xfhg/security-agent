import { resolveContainedCommand } from "../core/toolchain.ts";
export async function detectSemble() {
  const resolved = await resolveContainedCommand("semble");
  return {
    name: "semble",
    available: resolved.contained,
    path: resolved.contained ? resolved.command : undefined,
    reason: resolved.contained ? undefined : resolved.reason,
    capabilities: ["local-code-search", "retrieval"]
  };
}
