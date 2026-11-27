import { appendPromptArg, assertReadOnlyExtraArgs, BaseAgent, parseAgentOutput, runProcess } from "./baseAgent.js";

const CLAUDE_EFFORT_MAP = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
};

/**
 * Módulo específico para Claude Code CLI (`claude`).
 * Aquí viven los flags y particularidades propias de Claude
 * (ej. modo print `-p`, selección de modelo, esfuerzo de razonamiento).
 */
export class ClaudeAgent extends BaseAgent {
  buildArgs(prompt, { readOnly = false } = {}) {
    const args = ["-p"];
    if (this.config.model) {
      args.push("--model", this.config.model);
    }
    const extraArgs = Array.isArray(this.config.extraArgs) ? this.config.extraArgs : [];
    const hasEffort = extraArgs.some((arg) => arg === "--effort" || arg.startsWith("--effort="));
    const mappedEffort = CLAUDE_EFFORT_MAP[String(this.config.reasoningEffort || "").toLowerCase()];
    if (mappedEffort && !hasEffort) {
      args.push("--effort", mappedEffort);
    }
    if (readOnly) {
      assertReadOnlyExtraArgs(this.name, extraArgs, {
        modeFlags: ["--permission-mode"],
        safeValue: "plan",
        forbidden: ["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions"],
      });
    }
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
