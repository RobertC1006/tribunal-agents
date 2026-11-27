import { appendPromptArg, assertReadOnlyExtraArgs, BaseAgent, parseAgentOutput, runProcess } from "./baseAgent.js";

/**
 * Módulo específico para OpenCode CLI (`opencode run`).
 * El esfuerzo de razonamiento va dentro del modelo como variante
 * (`proveedor/modelo#high`), porque cada modelo define las suyas.
 * Requiere stdin cerrado: con stdin abierto `opencode run` espera leerlo.
 */
export class OpencodeAgent extends BaseAgent {
  buildArgs(prompt, images = [], { readOnly = false } = {}) {
    const args = ["run"];
    if (this.config.model) {
      args.push("-m", this.config.model);
    }
    const extraArgs = Array.isArray(this.config.extraArgs) ? this.config.extraArgs : [];
    if (readOnly) {
      assertReadOnlyExtraArgs(this.name, extraArgs, { modeFlags: ["--agent"], safeValue: "plan" });
    }
    const hasAgent = extraArgs.some((arg) => arg === "--agent" || arg.startsWith("--agent="));
    if (readOnly && !hasAgent) {
      args.push("--agent", "plan");
    }
    args.push(...extraArgs);
    for (const imagePath of images) {
      args.push("-f", imagePath);
    }
    return appendPromptArg(args, prompt);
  }

  async ask({ prompt, cwd, timeoutMs, images = [], readOnly = false, signal }) {
    const stdout = await runProcess({
      command: this.config.command || "opencode",
      args: this.buildArgs(prompt, images, { readOnly }),
      timeoutMs: timeoutMs || this.config.timeoutMs || 90000,
      cwd,
      signal,
    });
    return parseAgentOutput(stdout);
  }
}
