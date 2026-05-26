import { runHeuristicRules } from "./heuristics.ts";
export async function runDeserializationParserAgent(repo: string) {
  return runHeuristicRules(repo, [
    { agent: "deserialization-parser-agent", tool: "local-heuristic", bugClass: "deserialization", title: "Unsafe deserialization or eval-like parser use", severity: "high", confidence: "medium", pattern: /\b(pickle\.loads|yaml\.load|marshal\.loads|eval\(|Function\(|unserialize\(|readObject\()/i, sink: "unsafe deserialization/parser", missingChecks: ["safe parser", "type validation"] },
    { agent: "deserialization-parser-agent", tool: "local-heuristic", bugClass: "deserialization", title: "Potential zip slip archive extraction", severity: "medium", confidence: "medium", pattern: /\b(extractall|adm-zip|yauzl|unzipper|ZipInputStream)\b/i, sink: "archive extraction", missingChecks: ["path traversal guard"] }
  ], "deserialization-parser");
}
