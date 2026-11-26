import { appendPromptArg, BaseAgent, parseAgentOutput, runProcess } from "./baseAgent.js";

/**
 * Módulo específico para Codex CLI (`codex`).
 * Encapsula la forma exacta de invocar Codex en modo no interactivo (`codex exec`).
 */
export class CodexAgent extends BaseAgent {
  buildArgs(prompt) {
    const args = ["exec"];
    if (this.config.model) {
      args.push("-m", this.config.model);
    }
    if (Array.isArray(this.config.extraArgs)) {
      args.push(...this.config.extraArgs);
    }
    return appendPromptArg(args, prompt);
  }

  async ask({ prompt }) {
    const command = this.config.command || "codex";
    const stdout = await runProcess({
      command,
      args: this.buildArgs(prompt),
      timeoutMs: this.config.timeoutMs || 90000,
    });
    return parseAgentOutput(stdout);
  }
}
