import { appendPromptArg, BaseAgent, parseAgentOutput, runProcess } from "./baseAgent.js";

/**
 * Módulo específico para Codex CLI (`codex`).
 * Encapsula la forma exacta de invocar Codex en modo no interactivo (`codex exec`).
 */
export class CodexAgent extends BaseAgent {
  buildArgs(prompt, images = [], { readOnly = false } = {}) {
    const args = ["exec"];
    if (this.config.model) {
      args.push("-m", this.config.model);
    }
    const extraArgs = Array.isArray(this.config.extraArgs) ? this.config.extraArgs : [];
    const hasSandbox = extraArgs.some((arg) => arg === "-s" || arg === "--sandbox" || arg.startsWith("--sandbox="));
    if (readOnly && !hasSandbox) {
      args.push("-s", "read-only");
    }
    if (extraArgs.length) {
      args.push(...extraArgs);
    }
    for (const imagePath of images) {
      args.push("-i", imagePath);
    }
    return appendPromptArg(args, prompt);
  }

  async ask({ prompt, cwd, timeoutMs, images = [], readOnly = false, signal }) {
    const command = this.config.command || "codex";
    const stdout = await runProcess({
      command,
      args: this.buildArgs(prompt, images, { readOnly }),
      timeoutMs: timeoutMs || this.config.timeoutMs || 90000,
      cwd,
      signal,
    });
    return parseAgentOutput(stdout);
  }
}
