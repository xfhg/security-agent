import { readFile } from "node:fs/promises";
import path from "node:path";
import { baseEnvelope } from "../../core/provenance.ts";
import { walk } from "./repo-cartographer.ts";

const manifests = new Set(["package.json", "requirements.txt", "pyproject.toml", "poetry.lock", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "composer.json", "Gemfile", "Dockerfile", "docker-compose.yml", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "go.sum", "Cargo.lock"]);

export async function buildDependencies(repo: string) {
  const files = (await walk(repo)).filter((file) => manifests.has(path.basename(file)) || file.endsWith(".tf") || file.includes(".github/workflows/") || file.includes(".gitlab-ci"));
  const dependencies: any[] = [];
  const risky: any[] = [];
  for (const file of files) {
    const full = path.join(repo, file);
    const body = await readFile(full, "utf8").catch(() => "");
    if (path.basename(file) === "package.json") {
      const json = JSON.parse(body);
      for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
        for (const [name, version] of Object.entries(json[section] ?? {})) {
          dependencies.push({ ecosystem: "npm", name, version, direct: true, manifest: file, section });
          if (String(version).startsWith("git+") || /postinstall|preinstall/.test(JSON.stringify(json.scripts ?? {}))) risky.push({ package: name, reason: "git dependency or install hook present", manifest: file });
        }
      }
    } else if (path.basename(file) === "requirements.txt") {
      for (const line of body.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#"))) dependencies.push({ ecosystem: "python", name: line.split(/[=<>~!]/)[0]?.trim(), version: line, direct: true, manifest: file });
    } else if (path.basename(file) === "go.mod") {
      for (const match of body.matchAll(/^\s*([a-zA-Z0-9_.:/-]+)\s+v?([^\s]+)/gm)) dependencies.push({ ecosystem: "go", name: match[1], version: match[2], direct: true, manifest: file });
    }
  }
  return { ...(await baseEnvelope(repo, "dependencies", "dependency-agent")), manifests: files, dependencies, risky_packages: risky, package_managers: [...new Set(dependencies.map((dep) => dep.ecosystem))] };
}
