import { assertReadOnlyExtraArgs, BaseAgent, parseAgentOutput, runProcess } from "./baseAgent.js";

/**
 * Módulo específico para Antigravity CLI (`agy`).
 * En `agy`, `-p` consume inmediatamente el siguiente argumento como prompt,
 * por lo que `--model` y `extraArgs` deben ir antes de `-p`.
 */
export class AgyAgent extends BaseAgent {
  buildArgs(prompt, { readOnly = false } = {}) {
    const args = [];
    if (this.config.model) {
      args.push("--model", this.config.model);
    }
    const extraArgs = Array.isArray(this.config.extraArgs) ? this.config.extraArgs : [];
    if (readOnly) {
      assertReadOnlyExtraArgs(this.name, extraArgs, {
        modeFlags: ["--mode"],
        safeValue: "plan",
        forbidden: ["--dangerously-skip-permissions"],
      });
    }
    const hasMode = extraArgs.some((arg) => arg === "--mode" || arg.startsWith("--mode="));
    if (readOnly && !hasMode) {
      args.push("--mode", "plan");
    }
    args.push(...extraArgs);
    if (typeof prompt === "string" && prompt.startsWith("-")) {
      args.push(`-p=${prompt}`);
    } else {
      args.push("-p", prompt);
    }
    return args;
  }

  async ask({ prompt, cwd, timeoutMs, readOnly = false, signal }) {
    const command = this.config.command || "agy";
    const request = readOnly
      ? `${prompt}\n\nUsa las herramientas integradas de búsqueda y lectura de archivos. No ejecutes comandos de terminal ni corras pruebas. Si no puedes verificar algo, indícalo y responde con la información disponible.`
      : prompt;
    const args = this.buildArgs(request, { readOnly });
    try {
      const stdout = await runProcess({
        command,
        args,
        timeoutMs: timeoutMs || this.config.timeoutMs || 90000,
        cwd,
        signal,
      });
      return parseAgentOutput(stdout);
    } catch (error) {
      if (/"command" permission that headless mode cannot prompt for/i.test(error.message)) {
        throw new Error(
          "Antigravity bloqueó un comando porque el modo no interactivo no puede pedir permiso. Pide una revisión de archivos en solo lectura. Si necesitas el resultado de un comando, ejecútalo tú e incluye su salida en el contexto.",
          { cause: error },
        );
      }
      throw error;
    }
  }
}
