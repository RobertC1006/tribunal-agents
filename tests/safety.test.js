import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAgent } from "../src/agents/registry.js";
import { TribunalEngine } from "../src/engine/tribunalEngine.js";
import { SessionStore } from "../src/sessions/sessionStore.js";

async function fakeCli(dir, name, body) {
  const file = path.join(dir, name);
  await writeFile(file, `#!/usr/bin/env node\n${body}\n`);
  await chmod(file, 0o755);
  return file;
}

async function withDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tribunal-safety-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("cancelar al abrir un caso corta todo el debate: no guarda rondas de error ni sigue con más rondas", async () => {
  await withDir(async (dir) => {
    const slow = await fakeCli(dir, "lento", "setTimeout(() => {}, 60000);");
    const store = new SessionStore(path.join(dir, "sessions"));
    const engine = new TribunalEngine({
      config: { sessionsDir: store.sessionsDir, defaultAgents: ["lento"], agents: { lento: { type: "claude", command: slow } } },
      store,
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const startedAt = Date.now();
    await assert.rejects(
      engine.openCase({ topic: "Tema", debateRounds: 3, signal: controller.signal }),
      (error) => error.name === "AbortError",
    );
    assert.ok(Date.now() - startedAt < 5000);
    assert.deepEqual(await store.list(), []);
  });
});

test("cancelar un cuestionamiento deja el caso «interrumpida» sin añadir la ronda cancelada", async () => {
  await withDir(async (dir) => {
    const slow = await fakeCli(dir, "lento", "setTimeout(() => {}, 60000);");
    const store = new SessionStore(path.join(dir, "sessions"));
    const engine = new TribunalEngine({
      config: {
        sessionsDir: store.sessionsDir,
        defaultAgents: ["sim"],
        agents: { sim: { type: "mock" }, lento: { type: "claude", command: slow } },
      },
      store,
    });
    const session = await engine.openCase({ topic: "Tema", debateRounds: 0 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    await assert.rejects(
      engine.challengeCase({ sessionId: session.id, objection: "¿Y si…?", targetAgents: ["lento"], signal: controller.signal }),
      (error) => error.name === "AbortError",
    );
    const saved = await store.load(session.id);
    assert.equal(saved.status, "interrumpida");
    assert.equal(saved.rounds.length, 1);
  });
});

test("los agentes siempre corren en solo lectura, también sin carpeta de proyecto", async () => {
  await withDir(async (dir) => {
    const echo = await fakeCli(dir, "eco", 'console.log("RESUMEN: " + process.argv.slice(2, -1).join(" "));');
    const store = new SessionStore(path.join(dir, "sessions"));
    const agents = {
      oc: { type: "opencode", command: echo },
      cl: { type: "claude", command: echo },
      cx: { type: "codex", command: echo },
      ag: { type: "agy", command: echo },
    };
    const engine = new TribunalEngine({ config: { sessionsDir: store.sessionsDir, defaultAgents: Object.keys(agents), agents }, store });
    const session = await engine.openCase({ topic: "Tema", debateRounds: 0 });
    const args = Object.fromEntries(session.rounds[0].entries.map((e) => [e.agent, e.summary]));
    assert.match(args.oc, /--agent plan/);
    assert.match(args.cl, /--permission-mode plan/);
    assert.match(args.cx, /-s read-only/);
    assert.match(args.ag, /--mode plan/);
  });
});

test("AgyAgent añade --mode plan en solo lectura salvo que extraArgs elija otro modo", () => {
  const agy = createAgent("agy", { type: "agy" });
  assert.deepEqual(agy.buildArgs("hola", { readOnly: true }), ["--mode", "plan", "-p", "hola"]);
  const custom = createAgent("agy", { type: "agy", extraArgs: ["--mode", "auto"] });
  assert.deepEqual(custom.buildArgs("hola", { readOnly: true }), ["--mode", "auto", "-p", "hola"]);
});
