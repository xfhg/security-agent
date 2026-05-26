import { stableHash } from "./provenance.ts";

const secretPatterns = [
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /(?<prefix>(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*["']?)(?<value>[^"'\s]{8,})/gi
];

export function redactSecrets(input: string): string {
  let output = input;
  for (const pattern of secretPatterns) {
    output = output.replace(pattern, (match: string, ...args: unknown[]) => {
      const groups = args.at(-1) as { prefix?: string; value?: string } | undefined;
      const value = groups?.value ?? match;
      const prefix = groups?.prefix ?? "";
      return `${prefix}[REDACTED:${stableHash(value).slice(0, 12)}]`;
    });
  }
  return output;
}

export function secretFingerprint(value: string): string {
  return stableHash(value).slice(0, 16);
}
