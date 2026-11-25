import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Carga y valida el archivo de configuración del tribunal.
 * Mantiene la configuración desacoplada del motor para que cualquier usuario
 * pueda añadir o quitar agentes (CLIs o modelos locales) sin tocar código.
 */
export async function loadConfig(configPath = path.resolve("tribunal.config.json")) {
  const raw = await readFile(configPath, "utf-8");
  const config = JSON.parse(raw);

  if (!config.agents || typeof config.agents !== "object") {
    throw new Error("tribunal.config.json debe incluir un objeto 'agents'.");
  }

  const baseDir = path.dirname(configPath);
  const sessionsDir = path.resolve(baseDir, config.sessionsDir || "./sessions");

  return {
    sessionsDir,
    defaultAgents: Array.isArray(config.defaultAgents)
      ? config.defaultAgents
      : Object.keys(config.agents),
    agents: config.agents,
  };
}
