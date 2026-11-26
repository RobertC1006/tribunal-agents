import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "../..");
export const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, "tribunal.config.default.json");

export function isInstalledPackage(rootDir = PROJECT_ROOT) {
  const normalized = path.resolve(rootDir);
  return (
    normalized.includes(`${path.sep}node_modules${path.sep}`) ||
    normalized.includes(`${path.sep}_npx${path.sep}`)
  );
}

export function getDataDir({ baseDir = PROJECT_ROOT, env = process.env } = {}) {
  if (env?.TRIBUNAL_HOME) {
    return path.resolve(env.TRIBUNAL_HOME);
  }
  if (isInstalledPackage(baseDir)) {
    return path.join(os.homedir(), ".agent-tribunal");
  }
  return path.resolve(baseDir);
}

export const LOCAL_CONFIG_PATH = path.join(getDataDir(), "tribunal.config.json");

async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves which config file to load:
 *  1. Explicit configPath argument
 *  2. TRIBUNAL_CONFIG environment variable (fails loudly if missing/invalid)
 *  3. Personal tribunal.config.json inside dataDir (repo root locally, ~/.agent-tribunal under npx)
 *  4. Versioned fallback tribunal.config.default.json
 */
export async function resolveConfigPath({
  configPath,
  baseDir = PROJECT_ROOT,
  env = process.env,
} = {}) {
  if (configPath) {
    return path.resolve(configPath);
  }
  if (env?.TRIBUNAL_CONFIG) {
    return path.resolve(env.TRIBUNAL_CONFIG);
  }
  const dataDir = getDataDir({ baseDir, env });
  const localPath = path.join(dataDir, "tribunal.config.json");
  if (await fileExists(localPath)) {
    return localPath;
  }
  return path.join(baseDir, "tribunal.config.default.json");
}

/**
 * Loads and validates the Tribunal configuration file.
 */
export async function loadConfig(configPath, options = {}) {
  const resolvedPath = await resolveConfigPath({ configPath, ...options });
  const raw = await readFile(resolvedPath, "utf-8");
  const config = JSON.parse(raw);

  if (!config.agents || typeof config.agents !== "object") {
    throw new Error(`${path.basename(resolvedPath)} debe incluir un objeto 'agents'.`);
  }

  const dataDir = configPath
    ? path.dirname(resolvedPath)
    : getDataDir({ baseDir: options.baseDir || PROJECT_ROOT, env: options.env || process.env });
  const sessionsDir = path.resolve(dataDir, config.sessionsDir || "./sessions");

  return {
    configPath: resolvedPath,
    dataDir,
    sessionsDir,
    defaultAgents: Array.isArray(config.defaultAgents)
      ? config.defaultAgents
      : Object.keys(config.agents),
    agents: config.agents,
  };
}
