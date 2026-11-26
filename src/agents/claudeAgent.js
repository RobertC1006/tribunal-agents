import { appendPromptArg, BaseAgent, parseAgentOutput, runProcess } from "./baseAgent.js";

/**
 * Módulo específico para Claude Code CLI (`claude`).
 * Aquí viven los flags y particularidades propias de Claude
 * (ej. modo print `-p`, selección de modelo, futuro `--resume`).
 */
export class ClaudeAgent extends BaseAgent {
  buildArgs(prompt, { readOnly = false } = {}) {
    const args = ["-p"];
    if (this.config.model) {
      args.push("--model", this.config.model);
    }
    const extraArgs = Array.isArray(this.config.extraArgs) ? this.config.extraArgs : [];
    const hasPermissionMode = extraArgs.some((arg) => arg === "--permission-mode" || arg.startsWith("--permission-mode="));
    if (readOnly && !hasPermissionMode) {
      args.push("--permission-mode", "plan");
    }
    if (extraArgs.length) {
      args.push(...extraArgs);
    }
    return appendPromptArg(args, prompt);
  }

  async ask({ prompt, cwd, timeoutMs, readOnly = false, signal }) {
    const command = this.config.command || "claude";
    const stdout = await runProcess({
      command,
      args: this.buildArgs(prompt, { readOnly }),
      timeoutMs: timeoutMs || this.config.timeoutMs || 90000,
      cwd,
      signal,
    });
    return parseAgentOutput(stdout);
  }
}
