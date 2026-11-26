import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TribunalEngine } from "../src/engine/tribunalEngine.js";
import { SessionStore } from "../src/sessions/sessionStore.js";

test("TribunalEngine rechaza debateRounds por encima del límite defensivo con statusCode 400", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-cap-test-"));
  try {
    const store = new SessionStore(tempDir);
    const engine = new TribunalEngine({
      config: {
        sessionsDir: tempDir,
        defaultAgents: ["sim1"],
        agents: { sim1: { type: "mock", stance: "pragmatico" } },
      },
      store,
    });

    await assert.rejects(
      engine.abrirCaso({ topic: "Demasiadas rondas", debateRounds: 50 }),
      (error) => error.statusCode === 400 && /entre 0 y 5/i.test(error.message),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("dos cuestionamientos concurrentes al mismo caso se serializan sin perder ninguna ronda", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-lock-test-"));
  try {
    const store = new SessionStore(tempDir);
    const engine = new TribunalEngine({
      config: {
        sessionsDir: tempDir,
        defaultAgents: ["sim1"],
        agents: { sim1: { type: "mock", stance: "critico" } },
      },
      store,
    });

    const created = await engine.abrirCaso({
      topic: "Concurrencia de objeciones",
      debateRounds: 0,
    });
    assert.equal(created.rounds.length, 1);

    await Promise.all([
      engine.cuestionarCaso({ sessionId: created.id, objection: "Objeción A" }),
      engine.cuestionarCaso({ sessionId: created.id, objection: "Objeción B" }),
    ]);

    const finalSession = await engine.inspeccionarCaso(created.id);
    assert.equal(finalSession.rounds.length, 3);
    const objections = finalSession.rounds.slice(1).map((r) => r.userObjection).sort();
    assert.deepEqual(objections, ["Objeción A", "Objeción B"]);
    assert.equal(finalSession.status, "dormida");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("SessionStore.list() ignora archivos JSON dañados y devuelve los válidos", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-corrupt-test-"));
  try {
    const store = new SessionStore(tempDir);
    const engine = new TribunalEngine({
      config: {
        sessionsDir: tempDir,
        defaultAgents: ["sim1"],
        agents: { sim1: { type: "mock", stance: "cauteloso" } },
      },
      store,
    });

    const valid = await engine.abrirCaso({ topic: "Caso sano", debateRounds: 0 });
    await writeFile(path.join(tempDir, "caso-20261126-broken.json"), "{json truncado...", "utf8");

    const list = await store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, valid.id);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("si falla una ronda inesperadamente, la sesión no queda pegada en estado activa", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-finally-test-"));
  try {
    const store = new SessionStore(tempDir);
    const engine = new TribunalEngine({
      config: {
        sessionsDir: tempDir,
        defaultAgents: ["sim1"],
        agents: { sim1: { type: "mock", stance: "pragmatico" } },
      },
      store,
    });

    const created = await engine.abrirCaso({ topic: "Prueba interrupción", debateRounds: 0 });
    await assert.rejects(
      engine.cuestionarCaso({
        sessionId: created.id,
        objection: "Forzar error con agente inexistente",
        targetAgents: ["no-existe"],
      }),
      /no existe/,
    );

    const reloaded = await engine.inspeccionarCaso(created.id);
    assert.notEqual(reloaded.status, "activa");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
