import { runHeuristicRules } from "./heuristics.ts";

const sensitive = String.raw`(?:secret|token|password|passwd|api[_-]?key|apikey|authorization|cookie|credential|private[_-]?key|session|webhook[_-]?secret|client[_-]?secret)`;

export async function runSensitiveExposureAgent(repo: string) {
  return runHeuristicRules(repo, [
    {
      agent: "sensitive-exposure-agent",
      tool: "local-heuristic",
      bugClass: "secrets",
      title: "Potential sensitive value exposed through logging or telemetry",
      severity: "high",
      confidence: "medium",
      pattern: new RegExp(String.raw`\b(?:log|logger|slog|zap|zerolog|console|fmt|print|println|telemetry|trace|span)\b[^\n;]*${sensitive}[^\n;]*`, "i"),
      sink: "sensitive data in log or telemetry",
      missingChecks: ["log redaction", "sensitive field suppression"]
    },
    {
      agent: "sensitive-exposure-agent",
      tool: "local-heuristic",
      bugClass: "secrets",
      title: "Potential sensitive value exposed through response or error output",
      severity: "high",
      confidence: "medium",
      pattern: new RegExp(String.raw`\b(?:res|response|reply|ctx|writer|w)\.(?:send|json|write|end|body|error|status)\b[^\n;]*${sensitive}[^\n;]*`, "i"),
      sink: "sensitive data in response or error output",
      missingChecks: ["response redaction", "sensitive field suppression"]
    },
    {
      agent: "sensitive-exposure-agent",
      tool: "local-heuristic",
      bugClass: "config",
      title: "Potential sensitive configuration dump",
      severity: "medium",
      confidence: "medium",
      pattern: new RegExp(String.raw`\b(?:dump|debug|marshal|stringify|serialize|inspect)\b[^\n;]*(?:config|env|settings|headers)[^\n;]*${sensitive}?`, "i"),
      sink: "configuration/debug output",
      missingChecks: ["debug output suppression", "secret redaction"]
    }
  ], "logging-exposure");
}
