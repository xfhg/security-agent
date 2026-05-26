import { runHeuristicRules } from "./heuristics.ts";
export async function runSecretsConfigAgent(repo: string) {
  return runHeuristicRules(repo, [
    { agent: "secrets-config-agent", tool: "local-heuristic", bugClass: "secrets", title: "Potential hardcoded secret or credential", severity: "high", confidence: "medium", pattern: /\b(password|passwd|secret|token|api[_-]?key)\b\s*[:=]\s*["'][^"']{8,}["']/i, sink: "secret literal", missingChecks: ["secret management"] },
    { agent: "secrets-config-agent", tool: "local-heuristic", bugClass: "secrets", title: "Potential secret passed to observable output", severity: "high", confidence: "medium", pattern: /\b(?:Str|WithField|field|setField|print|printf|println|log|logger|console|send|json)\b[^\n;]*(?:password|passwd|secret|token|api[_-]?key|apikey|authorization|cookie|credential|private[_-]?key|session)[^\n;]*/i, sink: "observable output argument", missingChecks: ["secret redaction"] },
    { agent: "secrets-config-agent", tool: "local-heuristic", bugClass: "secrets", title: "Potential AWS access key", severity: "high", confidence: "medium", pattern: /AKIA[0-9A-Z]{16}/, sink: "cloud credential", missingChecks: ["secret management"] },
    { agent: "secrets-config-agent", tool: "local-heuristic", bugClass: "config", title: "Permissive CORS configuration", severity: "medium", confidence: "medium", pattern: /Access-Control-Allow-Origin.*\*|origin\s*:\s*["']\*["']|cors\(\s*\{/i, sink: "cors policy", missingChecks: ["origin allowlist"] },
    { agent: "secrets-config-agent", tool: "local-heuristic", bugClass: "config", title: "Debug mode appears enabled", severity: "low", confidence: "low", pattern: /\b(debug|DEBUG)\b\s*[:=]\s*(true|1|["']true["'])/i, sink: "debug config", missingChecks: ["production config check"] }
  ], "secrets-config");
}
