import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import { createAgent } from "../src/agents/registry.js";
import { editConfig } from "../src/config/configEditor.js";
import { resolveAgentTimeoutMs } from "../src/engine/tribunalEngine.js";

test("ClaudeAgent, CodexAgent y AgyAgent traducen reasoningEffort según cada CLI", () => {
  const claudeHigh = createAgent("claude", {
    type: "claude",
    model: "claude-opus-5-5",
    reasoningEffort: "high",
  });
  assert.deepEqual(claudeHigh.buildArgs("hola"), [
    "-p",
    "--model",
    "claude-opus-5-5",
    "--effort",
    "high",
    "hola",
  ]);

  // Claude mapea xhigh -> high
  const claudeXhigh = createAgent("claude", {
    type: "claude",
    reasoningEffort: "xhigh",
  });
  assert.deepEqual(claudeXhigh.buildArgs("hola"), ["-p", "--effort", "high", "hola"]);

  const codex = createAgent("codex", {
    type: "codex",
    model: "gpt-6.2-astra",
    reasoningEffort: "xhigh",
  });
  assert.deepEqual(codex.buildArgs("hola"), [
    "exec",
    "-m",
    "gpt-6.2-astra",
    "-c",
    "model_reasoning_effort=xhigh",
    "hola",
  ]);

  // Agy ya codifica el esfuerzo en el ID del modelo; no debe añadir flag inválido
  const agy = createAgent("agy", {
    type: "agy",
    model: "gemini-4-neon-xhigh",
    reasoningEffort: "xhigh",
  });
  assert.deepEqual(agy.buildArgs("hola"), ["--model", "gemini-4-neon-xhigh", "-p", "hola"]);
});

test("resolveAgentTimeoutMs aplica pisos inteligentes según reasoningEffort o sufijo del modelo", () => {
  assert.equal(
    resolveAgentTimeoutMs({ type: "claude", timeoutMs: 90000, reasoningEffort: "low" }),
    90000,
  );
  assert.equal(
    resolveAgentTimeoutMs({ type: "claude", timeoutMs: 90000, reasoningEffort: "high" }),
    180000,
  );
  assert.equal(
    resolveAgentTimeoutMs({ type: "codex", timeoutMs: 90000, reasoningEffort: "xhigh" }),
    300000,
  );
  assert.equal(
    resolveAgentTimeoutMs({ type: "agy", timeoutMs: 90000, model: "gemini-4-neon-high" }),
    180000,
  );
  assert.equal(
    resolveAgentTimeoutMs({ type: "agy", timeoutMs: 90000, model: "gemini-4-neon-xhigh" }),
    300000,
  );
  assert.equal(
    resolveAgentTimeoutMs(
      { type: "claude", timeoutMs: 420000, reasoningEffort: "high" },
      { sessionTimeoutMs: 180000 },
    ),
    420000,
  );
});

test("configurar permite definir y limpiar reasoningEffort en un perfil (opción 6)", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "tribunal-effort-cfg-"));
  try {
    const configPath = path.join(cwd, "tribunal.config.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          sessionsDir: "./sessions",
          defaultAgents: ["codex"],
          agents: { codex: { type: "codex", timeoutMs: 90000 } },
        },
        null,
        2,
      ),
    );

    // 6 -> codex -> high -> 0 salir
    const inputSet = Readable.from(["6\ncodex\nhigh\n0\n"]);
    const outSet = new PassThrough();
    await editConfig({ configPath, input: inputSet, output: outSet });
    const savedSet = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(savedSet.agents.codex.reasoningEffort, "high");

    // 6 -> codex -> - (restablecer) -> 0 salir
    const inputClear = Readable.from(["6\ncodex\n-\n0\n"]);
    const outClear = new PassThrough();
    await editConfig({ configPath, input: inputClear, output: outClear });
    const savedClear = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(savedClear.agents.codex.reasoningEffort, undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
