import { spawn } from "node:child_process";

const SECTION_COLON_RE =
  /^\s*(?:(?:#{1,6}\s+)|(?:[-*+]\s+)|(?:\d+[.)]\s+))*(?:\*\*|__)?\s*(RESUMEN|DISIDENCIAS|RAZONAMIENTO)\s*(?:(?:\*\*|__)?\s*:\s*(?:\*\*|__)?)\s*(.*)$/i;

const SECTION_HEADING_RE =
  /^\s*(?:(?:#{1,6}\s+)|(?:[-*+]\s+)|(?:\d+[.)]\s+))*(?:\*\*|__)?\s*(RESUMEN|DISIDENCIAS|RAZONAMIENTO)\s*(?:\*\*|__)?\s*$/i;

/**
 * Extrae las 3 secciones estructuradas que usa el tribunal para
 * compactar contexto entre rondas y guardar el detalle completo para el usuario.
 * Tolera encabezados Markdown, listas y negritas que suelen emitir los modelos reales.
 */
export function parseAgentOutput(rawText) {
  const text = String(rawText || "").replace(/\r\n/g, "\n").trim();
  const sections = { resumen: [], disidencias: [], razonamiento: [] };
  let current = null;

  for (const line of text.split("\n")) {
    const colonMatch = line.match(SECTION_COLON_RE);
    if (colonMatch) {
      current = colonMatch[1].toLowerCase();
      if (colonMatch[2].trim()) {
        sections[current].push(colonMatch[2].trim());
      }
      continue;
    }

    const headingMatch = line.match(SECTION_HEADING_RE);
    if (headingMatch) {
      current = headingMatch[1].toLowerCase();
      continue;
    }

    if (current) {
      sections[current].push(line);
    }
  }

  const resumen =
    sections.resumen.join("\n").trim() ||
    text.split("\n").slice(0, 2).join(" ").slice(0, 260);

  const disidencias =
    sections.disidencias.join("\n").trim() ||
    "Sin disidencias explícitas registradas.";

  const razonamiento = sections.razonamiento.join("\n").trim() || text;

  return {
    resumen,
    disidencias,
    razonamiento,
    raw: text,
  };
}

/**
 * Añade el prompt como argumento posicional protegiéndolo con `--` si empieza por `-`.
 */
export function appendPromptArg(args, prompt) {
  if (typeof prompt === "string" && prompt.startsWith("-")) {
    args.push("--");
  }
  args.push(prompt);
  return args;
}

/**
 * Helper compartido para ejecutar un proceso CLI puntual y cerrarlo al terminar.
 * Cada agente CLI (Claude, Codex, AGY) decide sus propios comandos y flags.
 */
export function runProcess({
  command,
  args,
  timeoutMs = 90000,
  killGraceMs = 2000,
  maxOutputBytes = 4 * 1024 * 1024,
  input,
  cwd,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: [input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let totalBytes = 0;
    let finished = false;
    let exited = false;
    let forceKillTimer;

    const cleanupTimers = () => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };

    const killProcess = (reasonError) => {
      if (finished) return;
      finished = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!exited) {
          child.kill("SIGKILL");
        }
      }, killGraceMs);
      reject(reasonError);
    };

    const timer = setTimeout(() => {
      killProcess(new Error(`Timeout (${timeoutMs}ms) ejecutando "${command}".`));
    }, timeoutMs);

    if (input !== undefined && child.stdin) {
      child.stdin.end(String(input));
    }

    const collect = (target, chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxOutputBytes) {
        cleanupTimers();
        killProcess(new Error(`Salida excesiva (>${maxOutputBytes} bytes) ejecutando "${command}".`));
        return target;
      }
      return target + chunk.toString("utf-8");
    };

    child.stdout.on("data", (chunk) => {
      stdout = collect(stdout, chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr = collect(stderr, chunk);
    });

    child.on("error", (error) => {
      exited = true;
      cleanupTimers();
      if (!finished) {
        finished = true;
        reject(
          new Error(
            `No se pudo iniciar "${command}" (${error.code || error.message}). Verifica que esté instalado en tu PATH.`
          )
        );
      }
    });

    child.on("close", (code) => {
      exited = true;
      cleanupTimers();
      if (!finished) {
        finished = true;
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
