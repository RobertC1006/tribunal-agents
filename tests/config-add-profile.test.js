import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import { editConfig } from "../src/config/configEditor.js";
import { modelCatalog } from "../src/config/modelCatalog.js";

async function runEditor(answers) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tribunal-add-"));
  try {
    const configPath = path.join(dir, "tribunal.config.json");
    await writeFile(configPath, JSON.stringify({ defaultAgents: ["sim"], agents: { sim: { type: "mock" } } }));
    const output = new PassThrough();
    let printed = "";
    output.on("data", (chunk) => (printed += chunk));
    await editConfig({ configPath, fallbackPath: null, input: Readable.from([answers]), output });
    return { config: JSON.parse(await readFile(configPath, "utf8")), printed };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("«Añadir perfil nuevo» crea un perfil de cualquier tipo sin clonar otro (nombre por defecto = tipo)", async () => {
  const { config } = await runEditor("7\nopencode\n\nopencode/x#high\n0\n");
  assert.deepEqual(config.agents.opencode, {
    type: "opencode", command: "opencode", timeoutMs: 180000, model: "opencode/x#high",
  });
  assert.deepEqual(config.defaultAgents, ["sim"]);
});

test("«Añadir perfil nuevo» para Ollama usa la URL local y exige modelo", async () => {
  const { config } = await runEditor("7\nollama\nlocal2\nqwen3:4b\n0\n");
  assert.deepEqual(config.agents.local2, {
    type: "ollama", baseUrl: "http://localhost:11434", timeoutMs: 180000, model: "qwen3:4b",
  });
  const sinModelo = await runEditor("7\nollama\nlocal3\n\n0\n");
  assert.equal(sinModelo.config.agents.local3, undefined);
  assert.match(sinModelo.printed, /Ollama requiere un ID de modelo/);
});

test("«Añadir perfil nuevo» rechaza tipos desconocidos y nombres ya usados", async () => {
  const tipo = await runEditor("7\ngemini\n0\n");
  assert.deepEqual(Object.keys(tipo.config.agents), ["sim"]);
  assert.match(tipo.printed, /claude, codex, agy, opencode, ollama/);
  const nombre = await runEditor("7\ncodex\nsim\n0\n");
  assert.equal(nombre.config.agents.sim.type, "mock");
});

test("sin caché de Codex el catálogo ofrece una lista de respaldo en vez de quedar vacío", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tribunal-codex-home-"));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = dir;
  try {
    const models = await modelCatalog({ type: "codex" });
    assert.ok(models.some((m) => m.value === "gpt-6.2-sol"));
    assert.ok(models.every((m) => /sin verificar/.test(m.detail)));
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
