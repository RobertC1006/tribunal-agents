import { spawn } from "node:child_process";

const SECTION_COLON_RE =
  /^\s*(?:(?:#{1,6}\s+)|(?:[-*+]\s+)|(?:\d+[.)]\s+))*(?:\*\*|__)?\s*(RESUMEN|DISIDENCIAS|RAZONAMIENTO|SUMMARY|DISSENTS|REASONING)\s*(?:(?:\*\*|__)?\s*:\s*(?:\*\*|__)?)\s*(.*)$/i;

const SECTION_HEADING_RE =
  /^\s*(?:(?:#{1,6}\s+)|(?:[-*+]\s+)|(?:\d+[.)]\s+))*(?:\*\*|__)?\s*(RESUMEN|DISIDENCIAS|RAZONAMIENTO|SUMMARY|DISSENTS|REASONING)\s*(?:\*\*|__)?\s*$/i;

const SECTION_ALIASES = {
  resumen: "summary",
  summary: "summary",
  disidencias: "dissents",
  dissents: "dissents",
  razonamiento: "reasoning",
  reasoning: "reasoning",
};

/**
 * Extracts the 3 structured sections used to compact context between rounds
 * and store full reasoning for the user. Tolerates Markdown headings, lists, and bold.
 */
export function parseAgentOutput(rawText) {
  const text = String(rawText || "").replace(/\r\n/g, "\n").trim();
  const sections = { summary: [], dissents: [], reasoning: [] };
  let current = null;

  for (const line of text.split("\n")) {
    const colonMatch = line.match(SECTION_COLON_RE);
    if (colonMatch) {
      current = SECTION_ALIASES[colonMatch[1].toLowerCase()];
      if (colonMatch[2].trim()) {
        sections[current].push(colonMatch[2].trim());
      }
      continue;
    }

    const headingMatch = line.match(SECTION_HEADING_RE);
    if (headingMatch) {
      current = SECTION_ALIASES[headingMatch[1].toLowerCase()];
      continue;
    }

    if (current) {
      sections[current].push(line);
    }
  }

  const summary =
    sections.summary.join("\n").trim() ||
    text.split("\n").slice(0, 2).join(" ").slice(0, 260);

  const dissents =
    sections.dissents.join("\n").trim() ||
    "Sin disidencias explícitas registradas.";

  const reasoning = sections.reasoning.join("\n").trim() || text;

  return {
    summary,
    dissents,
    reasoning,
    raw: text,
  };
}

/**
 * En solo lectura, un perfil no puede elegir otro modo de permisos ni saltarse los permisos:
 * mejor que el magistrado falle con un mensaje claro a que escriba en el proyecto.
 * `modeFlags` solo admiten `safeValue` (como `--flag valor` o `--flag=valor`).
 */
export function assertReadOnlyExtraArgs(agentName, extraArgs, { modeFlags, safeValue, forbidden = [] }) {
  extraArgs.forEach((arg, index) => {
    const [flag, inlineValue] = String(arg).split(/=(.*)/s);
    const value = inlineValue ?? extraArgs[index + 1];
    const conflict = forbidden.includes(flag) ? flag : modeFlags.includes(flag) && value !== safeValue ? `${flag} ${value}` : null;
    if (conflict) {
      throw new Error(
        `El perfil "${agentName}" quita el modo de solo lectura con "${conflict}" en extraArgs. Los magistrados no pueden escribir; quítalo del perfil.`
      );
    }
  });
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
  // Un agente que sale con 0 sin escribir nada falló en silencio (p. ej. agy sin permiso).
  allowEmptyOutput = false,
  input,
  cwd,
  signal,
}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error(`Ejecución cancelada para "${command}".`);
      error.name = "AbortError";
      reject(error);
      return;
    }

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

    const onAbort = () => {
      const error = new Error(`Ejecución cancelada para "${command}".`);
      error.name = "AbortError";
      killProcess(error);
    };

    const cleanupTimers = () => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    const killProcess = (reasonError) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
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

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    if (input !== undefined && child.stdin) {
      child.stdin.end(String(input));
    }

    // El stream decodifica UTF-8 y guarda los bytes de una letra partida hasta el siguiente trozo.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const collect = (target, chunk) => {
      totalBytes += Buffer.byteLength(chunk);
      if (totalBytes > maxOutputBytes) {
        cleanupTimers();
        killProcess(new Error(`Salida excesiva (>${maxOutputBytes} bytes) ejecutando "${command}".`));
        return target;
      }
      return target + chunk;
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
        if (code === 0 && !allowEmptyOutput && !stdout.trim()) {
          reject(new Error(`"${command}" terminó sin respuesta${stderr.trim() ? `: ${stderr.trim()}` : "."}`));
        } else if (code === 0) {
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
