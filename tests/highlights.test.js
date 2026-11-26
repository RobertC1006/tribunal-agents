import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createAgent } from "../src/agents/registry.js";
import { createApp } from "../src/api/createApp.js";
import { TribunalEngine } from "../src/engine/tribunalEngine.js";
import { buildPrompt } from "../src/sessions/contextBuilder.js";
import { SessionStore } from "../src/sessions/sessionStore.js";

const config = (sessionsDir) => ({
  sessionsDir,
  defaultAgents: ["sim1", "sim2"],
  agents: {
    sim1: { type: "mock", stance: "cauteloso" },
    sim2: { type: "mock", stance: "critico" },
  },
});

async function withEngine(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tribunal-hl-test-"));
  try {
    const engine = new TribunalEngine({ config: config(dir), store: new SessionStore(dir) });
    const session = await engine.openCase({ topic: "¿SQLite o JSON?", debateRounds: 0 });
    await fn({ dir, engine, session });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("destacar un fragmento lo guarda en la sesión, en el acta y en el prompt de la siguiente ronda", async () => {
  await withEngine(async ({ dir, engine, session }) => {
    const updated = await engine.highlightCase({
      sessionId: session.id, round: 1, agent: "sim1", text: "  el riesgo de corrupción  ", note: "¿Es real?",
    });
    assert.equal(updated.highlights.length, 1);
    const [hl] = updated.highlights;
    assert.deepEqual({ id: hl.id, round: hl.round, agent: hl.agent, text: hl.text, note: hl.note },
      { id: "d1", round: 1, agent: "sim1", text: "el riesgo de corrupción", note: "¿Es real?" });

    const reloaded = await engine.inspectCase(session.id);
    assert.equal(reloaded.highlights[0].text, "el riesgo de corrupción");

    const acta = await readFile(path.join(dir, `${session.id}.md`), "utf-8");
    assert.match(acta, /Fragmentos destacados/);
    assert.match(acta, /el riesgo de corrupción/);

    const agent = createAgent("sim2", { type: "mock" });
    for (const roundType of ["debate", "cuestionamiento"]) {
      const prompt = buildPrompt({ session: reloaded, agent, roundType, objection: "x" });
      assert.match(prompt, /FRAGMENTOS DESTACADOS POR EL USUARIO/);
      assert.match(prompt, /\[d1 · Ronda 1 · sim1\] "el riesgo de corrupción" — Nota del juez: ¿Es real\?/);
    }

    const second = await engine.highlightCase({ sessionId: session.id, round: 1, agent: "sim2", text: "otro" });
    assert.deepEqual(second.highlights.map((h) => h.id), ["d1", "d2"]);
  });
});

test("destacar rechaza ronda, agente o texto inválidos con error 400", async () => {
  await withEngine(async ({ engine, session }) => {
    const base = { sessionId: session.id, round: 1, agent: "sim1", text: "algo" };
    for (const bad of [{ round: 9 }, { agent: "nadie" }, { text: "   " }, { text: "x".repeat(2001) }]) {
      await assert.rejects(engine.highlightCase({ ...base, ...bad }), (error) => error.statusCode === 400);
    }
  });
});

test("quitar un destacado lo saca del prompt; un ID inexistente da 404", async () => {
  await withEngine(async ({ engine, session }) => {
    await engine.highlightCase({ sessionId: session.id, round: 1, agent: "sim1", text: "fragmento" });
    const cleaned = await engine.removeHighlight({ sessionId: session.id, highlightId: "d1" });
    assert.deepEqual(cleaned.highlights, []);
    const prompt = buildPrompt({ session: cleaned, agent: createAgent("sim1", { type: "mock" }), roundType: "debate" });
    assert.doesNotMatch(prompt, /FRAGMENTOS DESTACADOS/);
    await assert.rejects(engine.removeHighlight({ sessionId: session.id, highlightId: "d1" }), (e) => e.statusCode === 404);
  });
});

test("API: POST y DELETE /api/casos/:id/destacados", async () => {
  await withEngine(async ({ dir, engine, session }) => {
    const server = await new Promise((resolve) => {
      const instance = createApp({ config: config(dir), engine }).listen(0, "127.0.0.1", () => resolve(instance));
    });
    try {
      const base = `http://127.0.0.1:${server.address().port}/api/casos/${session.id}/destacados`;
      const created = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ round: 1, agent: "sim2", text: "punto clave" }),
      });
      assert.equal(created.status, 201);
      assert.equal((await created.json()).data.highlights[0].text, "punto clave");

      const bad = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ round: 1, agent: "sim2" }),
      });
      assert.equal(bad.status, 400);

      const removed = await fetch(`${base}/d1`, { method: "DELETE" });
      assert.equal(removed.status, 200);
      assert.deepEqual((await removed.json()).data.highlights, []);
    } finally {
      server.close();
    }
  });
});

test("CLI: `destacar` guarda el fragmento y `quitar-destacado` lo elimina", async () => {
  await withEngine(async ({ dir, session }) => {
    const configPath = path.join(dir, "tribunal.config.json");
    await writeFile(configPath, JSON.stringify(config(dir)));
    const run = (...args) => promisify(execFile)(process.execPath, [path.resolve("src/index.js"), ...args], {
      env: { ...process.env, TRIBUNAL_CONFIG: configPath, NO_COLOR: "1" },
    });
    const store = new SessionStore(dir);

    const { stdout } = await run("destacar", session.id, "1", "sim1", "esto importa", "revisadlo");
    assert.match(stdout, /d1/);
    assert.equal((await store.load(session.id)).highlights[0].note, "revisadlo");

    await run("quitar-destacado", session.id, "d1");
    assert.deepEqual((await store.load(session.id)).highlights, []);
  });
});
