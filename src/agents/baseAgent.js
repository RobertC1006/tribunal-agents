import { spawn } from "node:child_process";

/**
 * Extrae las 3 secciones estructuradas que usa el tribunal para
 * compactar contexto entre rondas y guardar el detalle completo para el usuario.
 */
export function parseAgentOutput(rawText) {
  const text = String(rawText || "").trim();

  const extractSection = (label, nextLabels) => {
    const nextPattern = nextLabels.length
      ? `(?=\\n\\s*(?:${nextLabels.join("|")})\\s*:|$)`
      : "$";
    const regex = new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)${nextPattern}`, "i");
    const match = text.match(regex);
    return match ? match[1].trim() : "";
  };

  const resumen =
    extractSection("RESUMEN", ["DISIDENCIAS", "RAZONAMIENTO"]) ||
    text.split("\n").slice(0, 2).join(" ").slice(0, 260);

  const disidencias =
    extractSection("DISIDENCIAS", ["RAZONAMIENTO", "RESUMEN"]) ||
    "Sin disidencias explícitas registradas.";

  const razonamiento =
    extractSection("RAZONAMIENTO", ["RESUMEN", "DISIDENCIAS"]) || text;

  return {
    resumen,
    disidencias,
    razonamiento,
    raw: text,
  };
}

/**
 * Helper compartido para ejecutar un proceso CLI puntual y cerrarlo al terminar.
 * Cada agente CLI (Claude, Codex, AGY) decide sus propios comandos y flags.
 */
export function runProcess({ command, args, timeoutMs = 90000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill("SIGTERM");
        reject(new Error(`Timeout (${timeoutMs}ms) ejecutando "${command}".`));
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (error) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(
          new Error(
            `No se pudo iniciar "${command}" (${error.code || error.message}). Verifica que esté instalado en tu PATH.`
          )
        );
      }
    });

    child.on("close", (code) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(
            new Error(
              `"${command}" terminó con código ${code}: ${stderr.trim() || stdout.trim()}`
            )
          );
        }
      }
    });
  });
}

/**
 * Contrato base que todos los módulos de agente implementan.
 */
export class BaseAgent {
  constructor(name, config = {}) {
    this.name = name;
    this.type = config.type || "unknown";
    this.role = config.role;
    this.config = config;
  }

  async ask(_input) {
    throw new Error(`El agente "${this.name}" debe implementar ask().`);
  }
}
