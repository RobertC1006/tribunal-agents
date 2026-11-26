import { appendPromptArg, BaseAgent, parseAgentOutput, runProcess } from "./baseAgent.js";

/**
 * Módulo específico para Codex CLI (`codex`).
 * Encapsula la forma exacta de invocar Codex en modo no interactivo (`codex exec`).
 */
export class CodexAgent extends BaseAgent {
  buildArgs(prompt, images = []) {
    const args = ["exec"];
    if (this.config.model) {
      args.push("-m", this.config.model);
    }
    if (Array.isArray(this.config.extraArgs)) {
      args.push(...this.config.extraArgs);
    }
    for (const imagePath of images) {
      args.push("-i", imagePath);
    }
    return appendPromptArg(args, prompt);
  }

  async ask({ prompt, cwd, timeoutMs, images = [] }) {
    const command = this.config.command || "codex";
    const stdout = await runProcess({
      command,
      args: this.buildArgs(prompt, images),
      timeoutMs: timeoutMs || this.config.timeoutMs || 90000,
      cwd,
    });
    return parseAgentOutput(stdout);
  }
}
