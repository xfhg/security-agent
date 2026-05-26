import { runHeuristicRules } from "./heuristics.ts";
export async function runInjectionAgent(repo: string) {
  return runHeuristicRules(repo, [
    { agent: "injection-agent", tool: "local-heuristic", bugClass: "injection", title: "Potential dynamic SQL execution", severity: "high", confidence: "medium", pattern: /\b(query|execute|raw|exec)\s*\([^)]*(\+|\$\{|format\()/i, sink: "dynamic query execution", missingChecks: ["parameterization", "input validation"] },
    { agent: "injection-agent", tool: "local-heuristic", bugClass: "injection", title: "Potential OS command injection sink", severity: "high", confidence: "medium", pattern: /\b(exec|spawn|execSync|system|popen|subprocess\.)\s*\([^)]*(req\.|request\.|params|query|body|\+)/i, sink: "command execution", missingChecks: ["command allowlist", "argument escaping"] },
    { agent: "injection-agent", tool: "local-heuristic", bugClass: "injection", title: "Potential path traversal file access", severity: "medium", confidence: "medium", pattern: /\b(readFile|writeFile|open|sendFile|createReadStream)\s*\([^)]*(req\.|params|query|body|\+)/i, sink: "file access", missingChecks: ["path normalization", "root containment"] },
    { agent: "injection-agent", tool: "local-heuristic", bugClass: "injection", title: "Potential SSRF request sink", severity: "high", confidence: "medium", pattern: /\b(fetch|axios\.|request\(|http\.get|https\.get)\s*\([^)]*(req\.|params|query|body)/i, sink: "outbound HTTP request", missingChecks: ["URL allowlist", "private network block"] }
  ], "injection");
}
