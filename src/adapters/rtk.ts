import { detectCommand } from "./tool-runner.ts";
export async function detectRtk() {
  return detectCommand("rtk", ["command-output-reduction"]);
}
