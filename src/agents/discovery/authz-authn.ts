import { runHeuristicRules } from "./heuristics.ts";
export async function runAuthzAuthnAgent(repo: string) {
  return runHeuristicRules(repo, [
    { agent: "authz-authn-agent", tool: "local-heuristic", bugClass: "authz", title: "Route handler may lack nearby authorization check", severity: "medium", confidence: "low", pattern: /\b(app|router)\.(get|post|put|patch|delete)\(["'`][^"'`]+["'`]/i, sink: "http route", missingChecks: ["authorization", "ownership check"] },
    { agent: "authz-authn-agent", tool: "local-heuristic", bugClass: "authn", title: "JWT verification may disable important checks", severity: "high", confidence: "medium", pattern: /verify\s*:\s*false|ignoreExpiration\s*:\s*true|algorithms\s*:\s*\[\s*["']none["']/i, sink: "jwt/session validation", missingChecks: ["signature or expiry verification"] },
    { agent: "authz-authn-agent", tool: "local-heuristic", bugClass: "authz", title: "Potential IDOR-style direct object lookup", severity: "medium", confidence: "low", pattern: /\b(findById|findUnique|findOne|getById)\s*\([^)]*(req\.params|params\.id|query\.id)/i, sink: "object lookup", missingChecks: ["ownership check"] }
  ], "authz-authn");
}
