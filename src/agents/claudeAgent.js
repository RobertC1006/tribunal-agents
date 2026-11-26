import { appendPromptArg, BaseAgent, parseAgentOutput, runProcess } from "./baseAgent.js";

/**
 * Módulo específico para Claude Code CLI (`claude`).
 * Aquí viven los flags y particularidades propias de Claude
 * (ej. modo print `-p`, selección de modelo, futuro `--resume`).
 */
export class ClaudeAgent extends BaseAgent {
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

  async ask({ prompt, cwd, timeoutMs }) {
    const command = this.config.command || "claude";
    const stdout = await runProcess({
      command,
      args: this.buildArgs(prompt),
      timeoutMs: timeoutMs || this.config.timeoutMs || 90000,
      cwd,
    });
    return parseAgentOutput(stdout);
  }
}
