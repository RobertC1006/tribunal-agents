import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PassThrough, Readable } from "node:stream";
import { createAgent, listSupportedAgentTypes } from "../src/agents/registry.js";
import { TribunalEngine } from "../src/engine/tribunalEngine.js";
import { SessionStore } from "../src/sessions/sessionStore.js";
import { buildPrompt } from "../src/sessions/contextBuilder.js";
import { editConfig } from "../src/config/configEditor.js";

test("el menú crea un perfil, permite elegirlo por defecto y conserva el resto del JSON", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "tribunal-config-test-"));
  try {
    const configPath = path.join(cwd, "tribunal.config.json");
    const initial = {
      sessionsDir: "./mis-casos",
      defaultAgents: ["claude1"],
      agents: { claude1: { type: "claude", model: "claude-fable-5-2", timeoutMs: 1000 } },
    };
    await writeFile(configPath, JSON.stringify(initial));
    const input = Readable.from(["2\nclaude1\nclaude2\nclaude-opus-5-5\n3\nclaude1,claude2\n0\n"]);
    const output = new PassThrough();
    await editConfig({ configPath, input, output });
    assert.match(output.read().toString(), /claude2.*claude-opus-5-5/);
    const saved = JSON.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(saved, {
      ...initial,
      defaultAgents: ["claude1", "claude2"],
      agents: {
        ...initial.agents,
        claude2: { ...initial.agents.claude1, model: "claude-opus-5-5" },
      },
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("el prompt solo asigna un rol cuando el usuario lo configura", () => {
  const session = { topic: "¿JSON o SQLite?" };
  const neutral = createAgent("agy", { type: "agy" });
  const configured = createAgent("agy", { type: "agy", role: "Revisa el consumo de memoria" });
  assert.doesNotMatch(buildPrompt({ session, agent: neutral, roundType: "apertura" }), /Tu rol:/);
  assert.match(buildPrompt({ session, agent: configured, roundType: "apertura" }), /Tu rol: Revisa el consumo de memoria/);
});

test("cada agente específico se resuelve desde su propio módulo en el registry", () => {
  const types = listSupportedAgentTypes();
  assert.deepEqual(types.sort(), ["agy", "claude", "codex", "mock", "ollama"]);

  const claude = createAgent("claude", { type: "claude", model: "sonnet" });
  assert.deepEqual(claude.buildArgs("hola"), ["-p", "--model", "sonnet", "hola"]);

  const codex = createAgent("codex", { type: "codex", model: "gpt-5" });
  assert.deepEqual(codex.buildArgs("hola"), ["exec", "-m", "gpt-5", "hola"]);

  const agy = createAgent("agy", { type: "agy" });
  assert.deepEqual(agy.buildArgs("hola"), ["-p", "hola"]);
});

test("flujo completo: abrir caso, quedar dormida, inspeccionar y cuestionar", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-test-"));

  try {
    const config = {
      sessionsDir: tempDir,
      defaultAgents: ["claude-sim", "codex-sim", "local-sim"],
      agents: {
        "claude-sim": { type: "mock", role: "Arquitecto", stance: "cauteloso" },
        "codex-sim": { type: "mock", role: "Pragmático", stance: "pragmatico" },
        "local-sim": { type: "mock", role: "Crítico", stance: "critico" },
      },
    };

    const store = new SessionStore(tempDir);
    const engine = new TribunalEngine({ config, store });

    await assert.rejects(
      engine.openCase({ topic: "Rondas inválidas", debateRounds: -1 }),
      /entero no negativo/,
    );

    // 1. Abrir caso (Ronda 1 apertura + Ronda 2 debate)
    const visibleRounds = [];
    const created = await engine.openCase({
      topic: "¿Monolito o microservicios?",
      context: "Equipo de 2 personas y 1 mes para MVP",
      onRound: (round) => visibleRounds.push(round.type),
    });

    assert.equal(created.status, "dormida");
    assert.equal(created.rounds.length, 2);
    assert.equal(created.rounds[0].entries.length, 3);
    assert.equal(created.rounds[1].type, "debate");
    assert.deepEqual(visibleRounds, ["apertura", "debate"]);

    // 2. Inspeccionar sesión dormida desde disco
    const loaded = await engine.inspectCase(created.id);
    assert.equal(loaded.id, created.id);
    assert.equal(loaded.topic, "¿Monolito o microservicios?");

    // 3. Cuestionar solo a dos agentes
    const updated = await engine.challengeCase({
      sessionId: created.id,
      objection: "¿Y si necesitamos desplegar offline en una laptop de 16GB?",
      targetAgents: ["codex-sim", "local-sim"],
      onRound: (round) => visibleRounds.push(round.type),
    });

    assert.equal(updated.status, "dormida");
    assert.equal(updated.rounds.length, 3);
    assert.equal(updated.rounds[2].type, "cuestionamiento");
    assert.equal(updated.rounds[2].entries.length, 2);
    assert.deepEqual(visibleRounds, ["apertura", "debate", "cuestionamiento"]);

    // 4. Listar sesiones guardadas
    const list = await engine.listCases();
    assert.equal(list.length, 1);
    assert.equal(list[0].roundsCount, 3);

    const participants = ["claude-sim", "codex-sim"];
    const repeated = await engine.openCase({
      topic: "¿JSON o SQLite?",
      agents: participants,
      debateRounds: 2,
    });
    assert.deepEqual(repeated.rounds.map((round) => round.type), ["apertura", "debate", "debate"]);
    for (const round of repeated.rounds) {
      assert.deepEqual(round.entries.map((entry) => entry.agent), participants);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
