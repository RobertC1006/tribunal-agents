import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAgent } from "../src/agents/registry.js";
import { TribunalEngine } from "../src/engine/tribunalEngine.js";
import { buildPrompt } from "../src/sessions/contextBuilder.js";
import { SessionStore } from "../src/sessions/sessionStore.js";

const agent = createAgent("sim", { type: "mock" });

function sessionWithRounds(count, textLength = 2000) {
  return {
    topic: "Tema",
    context: "",
    rounds: Array.from({ length: count }, (_, i) => ({
      number: i + 1,
      type: i === 0 ? "apertura" : "debate",
      entries: ["a", "b", "c"].map((name) => ({
        agent: name,
        summary: `R${i + 1}-${name}-resumen ` + "x".repeat(textLength),
        dissents: `R${i + 1}-${name}-disidencia ` + "y".repeat(textLength),
        reasoning: "z".repeat(textLength),
      })),
    })),
  };
}

test("el prompt deja de crecer: con 50 rondas mide casi lo mismo que con 20", () => {
  const len20 = buildPrompt({ session: sessionWithRounds(20), agent, roundType: "debate" }).length;
  const len50 = buildPrompt({ session: sessionWithRounds(50), agent, roundType: "debate" }).length;
  assert.ok(len50 < 30000, `prompt de ${len50} caracteres`);
  assert.ok(len50 - len20 < 50, `creció ${len50 - len20} caracteres`);
});

test("las rondas recientes van detalladas, las intermedias en una línea y las viejas se omiten", () => {
  const prompt = buildPrompt({ session: sessionWithRounds(10), agent, roundType: "debate" });
  assert.match(prompt, /R10-a-disidencia/);
  assert.match(prompt, /R9-a-disidencia/);
  assert.match(prompt, /R8-a-resumen/);
  assert.doesNotMatch(prompt, /R8-a-disidencia/);
  assert.match(prompt, /R3-a-resumen/);
  assert.doesNotMatch(prompt, /R2-a-resumen/);
  assert.match(prompt, /2 rondas anteriores omitidas/);
  assert.doesNotMatch(prompt, /x{1300}/);
});

test("un caso admite como máximo 10 destacados", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tribunal-ctx-"));
  try {
    const config = { sessionsDir: dir, defaultAgents: ["sim"], agents: { sim: { type: "mock" } } };
    const engine = new TribunalEngine({ config, store: new SessionStore(dir) });
    const session = await engine.openCase({ topic: "Tema", debateRounds: 0 });
    for (let i = 0; i < 10; i += 1) {
      await engine.highlightCase({ sessionId: session.id, round: 1, agent: "sim", text: `f${i}` });
    }
    await assert.rejects(
      engine.highlightCase({ sessionId: session.id, round: 1, agent: "sim", text: "uno más" }),
      (error) => error.statusCode === 400 && /10/.test(error.message),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
