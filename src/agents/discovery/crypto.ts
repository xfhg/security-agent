import { runHeuristicRules } from "./heuristics.ts";
export async function runCryptoAgent(repo: string) {
  return runHeuristicRules(repo, [
    { agent: "crypto-agent", tool: "local-heuristic", bugClass: "crypto", title: "Weak hash or crypto primitive", severity: "medium", confidence: "medium", pattern: /\b(md5|sha1|DES|RC4|ECB)\b/i, sink: "crypto primitive", missingChecks: ["modern algorithm selection"] },
    { agent: "crypto-agent", tool: "local-heuristic", bugClass: "crypto", title: "Disabled TLS certificate verification", severity: "high", confidence: "medium", pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|verify\s*=\s*False/i, sink: "tls verification", missingChecks: ["certificate validation"] },
    { agent: "crypto-agent", tool: "local-heuristic", bugClass: "crypto", title: "Predictable randomness for security-sensitive value", severity: "medium", confidence: "low", pattern: /Math\.random\(|random\.random\(/i, sink: "randomness", missingChecks: ["CSPRNG"] }
  ], "crypto");
}
