import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TribunalEngine } from "../src/engine/tribunalEngine.js";
import { SessionStore } from "../src/sessions/sessionStore.js";

// Dos motores con el mismo directorio = MCP y servidor web en procesos distintos.
async function setup(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tribunal-conc-"));
  try {
    const slow = path.join(dir, "lento");
    // Participa desde la apertura (responde al instante) y solo tarda al cuestionarlo.
    await writeFile(
      slow,
      '#!/usr/bin/env node\nconst delay = process.argv.join(" ").includes("CUESTIONAMIENTO") ? 800 : 0;\nsetTimeout(() => console.log("RESUMEN: tarde"), delay);\n',
    );
    await chmod(slow, 0o755);
    const config = {
      sessionsDir: path.join(dir, "sessions"),
      defaultAgents: ["sim"],
      agents: { sim: { type: "mock" }, lento: { type: "claude", command: slow } },
    };
    const engineA = new TribunalEngine({ config, store: new SessionStore(config.sessionsDir) });
    const engineB = new TribunalEngine({ config, store: new SessionStore(config.sessionsDir) });
    const session = await engineA.openCase({ topic: "Tema", agents: ["sim", "lento"], debateRounds: 0 });
    await fn({ engineA, engineB, session, store: engineA.store });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("un destacado hecho desde otro proceso durante un cuestionamiento no se pierde", async () => {
  await setup(async ({ engineA, engineB, session, store }) => {
    const challenge = engineA.challengeCase({ sessionId: session.id, objection: "¿Y?", targetAgents: ["lento"] });
    await new Promise((r) => setTimeout(r, 200));
    await engineB.highlightCase({ sessionId: session.id, round: 1, agent: "sim", text: "clave" });
    await challenge;
    const saved = await store.load(session.id);
    assert.equal(saved.rounds.length, 2);
    assert.deepEqual(saved.highlights.map((h) => h.text), ["clave"]);
    assert.equal(saved.status, "dormida");
  });
});

test("destacar no espera a que termine una ronda en curso del mismo proceso", async () => {
  await setup(async ({ engineA, session }) => {
    const challenge = engineA.challengeCase({ sessionId: session.id, objection: "¿Y?", targetAgents: ["lento"] });
    await new Promise((r) => setTimeout(r, 100));
    const startedAt = Date.now();
    await engineA.highlightCase({ sessionId: session.id, round: 1, agent: "sim", text: "rápido" });
    assert.ok(Date.now() - startedAt < 400, "destacar quedó bloqueado por la ronda");
    await challenge;
  });
});

test("escrituras simultáneas desde dos procesos no pisan los cambios del otro", async () => {
  await setup(async ({ engineA, engineB, session, store }) => {
    await Promise.all(Array.from({ length: 10 }, (_, i) =>
      (i % 2 ? engineA : engineB).highlightCase({ sessionId: session.id, round: 1, agent: "sim", text: `f${i}` })
    ));
    const saved = await store.load(session.id);
    assert.equal(saved.highlights.length, 10);
    assert.equal(new Set(saved.highlights.map((h) => h.id)).size, 10);
  });
});

test("un candado abandonado por un proceso caído no bloquea para siempre", async () => {
  await setup(async ({ engineB, session, store }) => {
    const lockPath = path.join(store.sessionsDir, `${session.id}.lock`);
    await writeFile(lockPath, "99999");
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);
    const updated = await engineB.highlightCase({ sessionId: session.id, round: 1, agent: "sim", text: "sigue" });
    assert.equal(updated.highlights.length, 1);
  });
});

test("un ID con ../ se rechaza sin tocar ningún .lock fuera de la carpeta de sesiones", async () => {
  await setup(async ({ store }) => {
    const outside = path.join(store.sessionsDir, "..", "yarn.lock");
    await writeFile(outside, "contenido ajeno");
    const old = new Date(Date.now() - 60_000);
    await utimes(outside, old, old);
    await assert.rejects(store.update("../yarn", () => {}), (error) => error.code === "INVALID_SESSION_ID");
    assert.equal(await readFile(outside, "utf-8"), "contenido ajeno");
  });
});
