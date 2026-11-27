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
