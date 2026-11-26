import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PassThrough, Readable } from "node:stream";
import { editConfig } from "../src/config/configEditor.js";
import { agentColor, agentOptions } from "../src/terminal.js";

test("agentColor diferencia agentes por proveedor (claude, codex, agy, ollama, mock)", () => {
  const agents = {
    claude: { type: "claude", model: "claude-opus-5-5" },
    codex: { type: "codex" },
    agy: { type: "agy" },
    ollama: { type: "ollama", model: "qwen2.5-coder:7b" },
    sim: { type: "mock", stance: "critico" },
  };

  const colors = new Set(Object.keys(agents).map((name) => agentColor(agents, name)));
  assert.equal(colors.size, 5);

  const options = agentOptions(agents);
  const claudeOpt = options.find((o) => o.value === "claude");
  assert.equal(claudeOpt.badge, "claude");
  assert.equal(claudeOpt.color, agentColor(agents, "claude"));
});

test("configurar permite eliminar perfiles (incluidos simuladores) y actualiza defaultAgents", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "tribunal-delete-test-"));
  try {
    const configPath = path.join(cwd, "tribunal.config.json");
    const initial = {
      sessionsDir: "./sessions",
      defaultAgents: ["claude-sim", "codex"],
      agents: {
        "claude-sim": { type: "mock", stance: "cauteloso" },
        codex: { type: "codex" },
      },
    };
    await writeFile(configPath, JSON.stringify(initial, null, 2));

    // Opción 4: eliminar claude-sim; luego intentar eliminar el último (codex) debe rechazarse; 0 salir
    const input = Readable.from(["4\nclaude-sim\n4\ncodex\n0\n"]);
    const output = new PassThrough();
    await editConfig({ configPath, input, output });

    const text = output.read().toString();
    assert.match(text, /Perfil "claude-sim" eliminado/);
    assert.match(text, /Debe quedar al menos un perfil/);

    const saved = JSON.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(Object.keys(saved.agents), ["codex"]);
    assert.deepEqual(saved.defaultAgents, ["codex"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
