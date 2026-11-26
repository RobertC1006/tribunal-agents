import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { runProcess } from "../agents/baseAgent.js";

// https://code.claude.com/docs/en/model-config
// https://platform.claude.com/docs/en/about-claude/model-deprecations
const claudeModels = [
  "fable", "opus", "sonnet", "haiku", "best", "opusplan", "opus[1m]", "sonnet[1m]",
  "claude-fable-5-2", "claude-fable-5-1", "claude-fable-5",
  "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
  "claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6",
  "claude-haiku-5-5", "claude-haiku-4-5-20251001",
];

// https://antigravity.google/docs/cli/headless/#select-a-model-effort-or-agent
const agyExamples = [
  "gemini-4-neon-xhigh", "gemini-4-neon-high", "gemini-4-neon-medium", "gemini-4-neon-low",
  "gemini-4-carbon-high", "gemini-4-carbon-medium", "gemini-4-carbon-low",
  "gemini-4-argon-high", "gemini-4-argon-medium",
  "gemini-4-hydrogen-xhigh", "gemini-4-hydrogen-high", "gemini-4-hydrogen-medium", "gemini-4-hydrogen-low",
  "gemini-pro-orchestrator-neon", "gemini-pro-orchestrator", "gemini-pro-orchestrator-argon",
  "gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.7-flash-high", "gemini-3.7-flash-medium",
  "gemini-3.6-flash-high", "gemini-3.6-flash-medium", "gemini-3.1-pro-high",
];

export function parseAgyModels(text) {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^([a-z0-9][a-z0-9._:-]*)(?:\t+| {2,})(\S.*)$/);
    return match ? [{ value: match[1], label: match[2], detail: match[1] }] : [];
  });
}

export function parseOpencodeModels(text) {
  return text.split(/\r?\n/).flatMap((line) => {
    const id = line.trim();
    return /^[\w.-]+\/\S+$/.test(id) ? [{ value: id, label: id, detail: "OpenCode" }] : [];
  });
}

export async function modelCatalog(profile) {
  if (profile.type === "claude") {
    return claudeModels.map((id) => ({ value: id, label: id, detail: "Claude Code · disponibilidad según la cuenta" }));
  }
  if (profile.type === "agy") {
    try {
      const stdout = await runProcess({ command: profile.command || "agy", args: ["models"], timeoutMs: 7000 });
      const models = parseAgyModels(stdout);
      if (models.length) return models;
    } catch {
      // La lista de la cuenta requiere que Antigravity pueda iniciar.
    }
    return agyExamples.map((id) => ({ value: id, label: id, detail: "Ejemplo oficial · acceso sin verificar" }));
  }
  if (profile.type === "opencode") {
    try {
      const stdout = await runProcess({ command: profile.command || "opencode", args: ["models"], timeoutMs: 7000 });
      return parseOpencodeModels(stdout);
    } catch {
      // Sin OpenCode instalado queda la entrada manual.
    }
  }
  if (profile.type === "codex") {
    const filename = path.join(process.env.CODEX_HOME || path.join(homedir(), ".codex"), "models_cache.json");
    try {
      const cache = JSON.parse(await readFile(filename, "utf8"));
      return cache.models.filter((model) => model.visibility === "list").map((model) => ({
        value: model.slug,
        label: model.display_name || model.slug,
        detail: model.slug,
      }));
    } catch {
      // Los perfiles configurados y la entrada manual siguen disponibles.
    }
  }
  return [];
}
