import { baseEnvelope } from "../../core/provenance.ts";

export async function buildThreatModel(repo: string, repoMap: any, dependencies: any, entrypoints: any): Promise<string> {
  const envelope = await baseEnvelope(repo, "threat-model", "threat-model-agent");
  const languages = (repoMap.languages?.languages ?? []).map((l: any) => `${l.language} (${l.files_count})`).join(", ") || "unknown";
  const eps = entrypoints.entrypoints ?? [];
  return `# Threat Model

- Artifact: ${envelope.artifact_type}
- Generated: ${envelope.created_at}
- Repo commit: ${envelope.repo_commit}

## Trust Boundaries
- External users or callers cross into detected entrypoints. Detected count: ${eps.length}.
- Dependency installation and build scripts are a supply-chain trust boundary.
- Configuration, CI, Docker, and IaC files are privileged operational surfaces when present.

## Assets
- Application source code and runtime secrets.
- Authentication, authorization, tenant, and admin boundaries.
- Dependency graph and build pipeline integrity.

## Evidence-Grounded Repo Summary
- Languages/frameworks signal: ${languages}.
- Dependency manifests: ${(dependencies.manifests ?? []).join(", ") || "none detected"}.
- Entrypoint examples: ${eps.slice(0, 10).map((ep: any) => `${ep.type}:${ep.name}@${ep.path}:${ep.line}`).join("; ") || "none detected"}.

## Likely Bug Classes
- Injection and unsafe file/shell handling where user input reaches sinks.
- Authn/authz failures around externally reachable handlers.
- Secret/config leakage in source, CI, Docker, and IaC.
- Dependency and install-script risk.
- Crypto misuse and weak randomness where security primitives are implemented locally.

## Unknowns And Assumptions
- Lightweight recon cannot prove runtime deployment, active routes, or environment configuration.
- Call graph and dataflow are fallback quality unless GitNexus/codeTree are available.
- High-severity claims require triage evidence, not scanner output alone.
`;
}
