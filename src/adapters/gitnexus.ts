import { detectCommand } from "./tool-runner.ts";
export async function detectGitNexus() {
  return detectCommand("gitnexus", ["knowledge-graph", "call-chain", "reachability"]);
}
