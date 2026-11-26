import { appendPromptArg, BaseAgent, parseAgentOutput, runProcess } from "./baseAgent.js";

/**
 * Módulo específico para Antigravity CLI (`agy`).
 * Centraliza los argumentos y futuro manejo de sesiones propios de AGY.
 */
export class AgyAgent extends BaseAgent {
  buildArgs(prompt) {
    const args = ["-p"];
    if (this.config.model) {
      args.push("--model", this.config.model);
    }
    if (Array.isArray(this.config.extraArgs)) {
      args.push(...this.config.extraArgs);
    }
    return appendPromptArg(args, prompt);
  }

  async ask({ prompt }) {
    const command = this.config.command || "agy";
    const stdout = await runProcess({
      command,
      args: this.buildArgs(prompt),
      timeoutMs: this.config.timeoutMs || 90000,
    });
    return parseAgentOutput(stdout);
  }
}
