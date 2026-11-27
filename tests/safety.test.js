import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    // Participa desde la apertura (responde al instante) y solo se cuelga al cuestionarlo.
    const slow = await fakeCli(
      dir,
      "lento",
      'if (process.argv.join(" ").includes("CUESTIONAMIENTO")) setTimeout(() => {}, 60000);\nelse console.log("RESUMEN: listo");',
    );
    const store = new SessionStore(path.join(dir, "sessions"));
    const engine = new TribunalEngine({
      config: {
        sessionsDir: store.sessionsDir,
        defaultAgents: ["sim", "lento"],
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

test("reanudar un caso con un magistrado que no participa se rechaza sin consultarlo ni tocar el caso", async () => {
  await withDir(async (dir) => {
    const spy = path.join(dir, "consultado");
    const outsider = await fakeCli(dir, "ajeno", `require("fs").writeFileSync(${JSON.stringify(spy)}, "sí");`);
    const store = new SessionStore(path.join(dir, "sessions"));
    const engine = new TribunalEngine({
      config: {
        sessionsDir: store.sessionsDir,
        defaultAgents: ["sim"],
        agents: { sim: { type: "mock" }, ajeno: { type: "claude", command: outsider } },
      },
      store,
    });
    const session = await engine.openCase({ topic: "Tema", debateRounds: 0 });
    for (const targetAgents of [["ajeno"], ["sim", "ajeno"], ["cluade"]]) {
      await assert.rejects(
        engine.challengeCase({ sessionId: session.id, objection: "¿Y?", targetAgents }),
        (error) => error.statusCode === 400 && /no participa/.test(error.message),
      );
      await assert.rejects(
        engine.debateCase({ sessionId: session.id, targetAgents }),
        (error) => error.statusCode === 400 && /no participa/.test(error.message),
      );
    }
    const saved = await store.load(session.id);
    assert.equal(saved.status, "dormida");
    assert.equal(saved.rounds.length, 1);
    await assert.rejects(readFile(spy), (error) => error.code === "ENOENT");
  });
});

test("un agente que termina bien pero sin escribir nada queda como error, con su mensaje de stderr", async () => {
  await withDir(async (dir) => {
    // Así se comporta agy cuando le niegan un permiso en modo no interactivo.
    const mute = await fakeCli(dir, "mudo", 'process.stderr.write("no output produced — permiso denegado");');
    const store = new SessionStore(path.join(dir, "sessions"));
    const engine = new TribunalEngine({
      config: { sessionsDir: store.sessionsDir, defaultAgents: ["mudo"], agents: { mudo: { type: "agy", command: mute } } },
      store,
    });
    const session = await engine.openCase({ topic: "Tema", debateRounds: 0 });
    const [entry] = session.rounds[0].entries;
    assert.match(entry.error || "", /sin respuesta.*permiso denegado/);
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

test("AgyAgent añade --mode plan en solo lectura y rechaza que extraArgs elija otro modo", () => {
  const agy = createAgent("agy", { type: "agy" });
  assert.deepEqual(agy.buildArgs("hola", { readOnly: true }), ["--mode", "plan", "-p", "hola"]);
  const custom = createAgent("agy", { type: "agy", extraArgs: ["--mode", "auto"] });
  assert.throws(() => custom.buildArgs("hola", { readOnly: true }), /solo lectura.*--mode auto/);
});

test("ningún perfil puede quitar el solo lectura desde extraArgs; elegir el valor seguro sí vale", () => {
  // Codex y OpenCode reciben las imágenes como segundo argumento.
  const readOnlyArgs = (type, extraArgs) => {
    const agent = createAgent(type, { type, extraArgs });
    return ["codex", "opencode"].includes(type)
      ? () => agent.buildArgs("hola", [], { readOnly: true })
      : () => agent.buildArgs("hola", { readOnly: true });
  };
  const blocked = [
    ["claude", ["--permission-mode", "acceptEdits"]],
    ["claude", ["--permission-mode=bypassPermissions"]],
    ["claude", ["--dangerously-skip-permissions"]],
    ["codex", ["-s", "workspace-write"]],
    ["codex", ["--sandbox=danger-full-access"]],
    ["codex", ["--full-auto"]],
    ["codex", ["--dangerously-bypass-approvals-and-sandbox"]],
    ["agy", ["--mode=auto"]],
    ["agy", ["--dangerously-skip-permissions"]],
    ["opencode", ["--agent", "build"]],
  ];
  for (const [type, extraArgs] of blocked) {
    assert.throws(readOnlyArgs(type, extraArgs), /solo lectura/, `${type} ${extraArgs.join(" ")}`);
  }

  const allowed = [
    ["claude", ["--permission-mode", "plan"]],
    ["codex", ["--sandbox=read-only"]],
    ["agy", ["--mode", "plan"]],
    ["opencode", ["--agent=plan"]],
  ];
  for (const [type, extraArgs] of allowed) {
    assert.doesNotThrow(readOnlyArgs(type, extraArgs), `${type} ${extraArgs.join(" ")}`);
  }

  // Fuera del tribunal (sin readOnly) el perfil sigue mandando.
  const free = createAgent("claude", { type: "claude", extraArgs: ["--permission-mode", "acceptEdits"] });
  assert.doesNotThrow(() => free.buildArgs("hola"));
});
