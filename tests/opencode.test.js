import assert from "node:assert/strict";
import test from "node:test";
import { createAgent, listSupportedAgentTypes } from "../src/agents/registry.js";
import { parseOpencodeModels } from "../src/config/modelCatalog.js";
import { agentColor } from "../src/terminal.js";

test("OpencodeAgent usa `opencode run` con modelo, imágenes y prompt protegido", () => {
  assert.ok(listSupportedAgentTypes().includes("opencode"));

  const plain = createAgent("opencode", { type: "opencode" });
  assert.deepEqual(plain.buildArgs("hola"), ["run", "hola"]);

  const full = createAgent("opencode", { type: "opencode", model: "openai/gpt-5#high", extraArgs: ["--thinking"] });
  assert.deepEqual(full.buildArgs("-tema", ["/tmp/a.png", "/tmp/b.png"]), [
    "run", "-m", "openai/gpt-5#high", "--thinking", "-f", "/tmp/a.png", "-f", "/tmp/b.png", "--", "-tema",
  ]);
});

test("OpencodeAgent usa el agente plan en solo lectura salvo que extraArgs elija otro", () => {
  const agent = createAgent("opencode", { type: "opencode" });
  assert.deepEqual(agent.buildArgs("hola", [], { readOnly: true }), ["run", "--agent", "plan", "hola"]);

  const custom = createAgent("opencode", { type: "opencode", extraArgs: ["--agent", "revisor"] });
  assert.deepEqual(custom.buildArgs("hola", [], { readOnly: true }), ["run", "--agent", "revisor", "hola"]);
});

test("parseOpencodeModels lee la lista proveedor/modelo de `opencode models`", () => {
  const stdout = "\x1b[0m\nopencode/seaglass-alpha-free\ngoogle/gemini-4-neon\n\nError raro\n";
  assert.deepEqual(parseOpencodeModels(stdout).map(({ value }) => value), [
    "opencode/seaglass-alpha-free",
    "google/gemini-4-neon",
  ]);
});

test("opencode tiene un color de proveedor distinto al resto", () => {
  const agents = {
    claude: { type: "claude" }, codex: { type: "codex" }, agy: { type: "agy" },
    ollama: { type: "ollama" }, sim: { type: "mock" }, opencode: { type: "opencode" },
  };
  const colors = new Set(Object.keys(agents).map((name) => agentColor(agents, name)));
  assert.equal(colors.size, 6);
  // Color fijo por proveedor, no el de respaldo que depende de la posición.
  assert.equal(agentColor({ solo: { type: "opencode" } }, "solo"), agentColor(agents, "opencode"));
});
