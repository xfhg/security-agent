import { detectCommand } from "./tool-runner.ts";
export async function detectUnderstandAnything() {
  return detectCommand("understand", ["repo-understanding", "graph-import"]);
}
