import { runCogniumSecurityScan } from "../../adapters/cognium.ts";

export async function runSemanticSastAgent(repo: string) {
  const result = await runCogniumSecurityScan(repo);
  return result.findings;
}
