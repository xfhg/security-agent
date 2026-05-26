import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { baseEnvelope } from "../../core/provenance.ts";

const excluded = new Set([".git", ".security-agent", ".claude", ".codetree", ".gitnexus", "node_modules", "vendor", "dist", "build", "coverage", ".cache", ".next", ".turbo"]);
const languageByExt: Record<string, string> = { ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript", ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".cs": "C#", ".php": "PHP", ".rb": "Ruby", ".tf": "Terraform", ".yaml": "YAML", ".yml": "YAML", ".json": "JSON", ".toml": "TOML", ".xml": "XML", ".swift": "Swift", ".sol": "Solidity" };

export async function buildRepoMap(repo: string) {
  const files = await walk(repo);
  const languages = new Map<string, number>();
  for (const file of files) {
    const lang = languageByExt[path.extname(file).toLowerCase()];
    if (lang) languages.set(lang, (languages.get(lang) ?? 0) + 1);
  }
  const modules = [...new Set(files.map((file) => file.split(path.sep)[0]).filter(Boolean))].slice(0, 80);
  return {
    repoMap: {
      ...(await baseEnvelope(repo, "repo-map", "repo-cartographer-agent")),
      files_count: files.length,
      modules,
      files: files.slice(0, 5000),
      excluded_directories: [...excluded]
    },
    languages: {
      ...(await baseEnvelope(repo, "languages", "repo-cartographer-agent")),
      languages: [...languages.entries()].map(([language, files_count]) => ({ language, files_count })).sort((a, b) => b.files_count - a.files_count)
    }
  };
}

export async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isDirectory()) await visit(full);
      else {
        const s = await stat(full);
        if (s.size < 2_000_000) files.push(rel);
      }
    }
  }
  await visit(root);
  return files.sort();
}
