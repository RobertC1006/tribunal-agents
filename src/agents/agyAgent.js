import { BaseAgent, parseAgentOutput, runProcess } from "./baseAgent.js";

/**
 * Módulo específico para Antigravity CLI (`agy`).
 * En `agy`, `-p` consume inmediatamente el siguiente argumento como prompt,
 * por lo que `--model` y `extraArgs` deben ir antes de `-p`.
 */
export class AgyAgent extends BaseAgent {
  buildArgs(prompt) {
    const args = [];
    if (this.config.model) {
      args.push("--model", this.config.model);
    }
    if (Array.isArray(this.config.extraArgs)) {
      args.push(...this.config.extraArgs);
    }
    if (typeof prompt === "string" && prompt.startsWith("-")) {
      args.push(`-p=${prompt}`);
    } else {
      args.push("-p", prompt);
    }
    return args;
  }

  async ask({ prompt, cwd, timeoutMs, signal }) {
    const command = this.config.command || "agy";
    const stdout = await runProcess({
      command,
      args: this.buildArgs(prompt),
      timeoutMs: timeoutMs || this.config.timeoutMs || 90000,
      cwd,
      signal,
    });
    return parseAgentOutput(stdout);
  }
}
