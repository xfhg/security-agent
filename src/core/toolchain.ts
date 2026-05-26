import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { binPath, localPath, securityAgentHome } from "./paths.ts";

const systemAllowlist = new Set(["git", "node", "bash", "sh", "mkdir", "find", "grep", "sed", "awk", "xargs", "dirname", "mktemp", "which"]);

export function containedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const home = securityAgentHome();
  return {
    ...process.env,
    HOME: localPath("home"),
    XDG_CACHE_HOME: localPath("cache"),
    XDG_CONFIG_HOME: localPath("config"),
    XDG_DATA_HOME: localPath("share"),
    npm_config_cache: localPath("cache", "npm"),
    BUN_INSTALL_CACHE_DIR: localPath("cache", "bun"),
    UV_CACHE_DIR: localPath("cache", "uv"),
    PIP_CACHE_DIR: localPath("cache", "pip"),
    OPENCODE_CONFIG_DIR: localPath("state", "opencode"),
    SECURITY_AGENT_HOME: home,
    PATH: [binPath("shims"), path.join(home, "node_modules", ".bin"), process.env.PATH ?? ""].join(path.delimiter),
    ...extra
  };
}

export async function resolveContainedCommand(name: string): Promise<{ command: string; contained: boolean; reason?: string }> {
  if (path.isAbsolute(name) || name.includes(path.sep)) {
    return executable(name) ? { command: name, contained: name.startsWith(securityAgentHome()) } : { command: name, contained: false, reason: "command path is not executable" };
  }

  for (const candidate of [binPath("shims", name), path.join(securityAgentHome(), "node_modules", ".bin", name)]) {
    if (await executable(candidate)) return { command: candidate, contained: true };
  }

  if (systemAllowlist.has(name)) return { command: name, contained: true };
  return { command: name, contained: false, reason: `local command not found under ${binPath("shims")} or node_modules/.bin` };
}

export async function executable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
