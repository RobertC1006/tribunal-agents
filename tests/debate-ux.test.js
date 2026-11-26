import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAgent } from "../src/agents/registry.js";
import { TribunalEngine } from "../src/engine/tribunalEngine.js";
import { buildPrompt } from "../src/sessions/contextBuilder.js";
import { SessionStore } from "../src/sessions/sessionStore.js";
import { renderRichLines } from "../src/terminal.js";

test("abrirCaso rechaza un workspaceDir inexistente con statusCode 400", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-badws-test-"));
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
      engine.openCase({
        topic: "Carpeta inexistente",
        workspaceDir: path.join(tempDir, "no-existe-jamas"),
        debateRounds: 0,
      }),
      (error) => error.statusCode === 400 && /no existe/i.test(error.message),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("debateCase añade ronda de réplica, incluye extracto de razonamiento reciente y emite eventos de progreso", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-debatir-test-"));
  try {
    const store = new SessionStore(tempDir);
    const engine = new TribunalEngine({
      config: {
        sessionsDir: tempDir,
        defaultAgents: ["sim1", "sim2"],
        agents: {
          sim1: { type: "mock", stance: "cauteloso" },
          sim2: { type: "mock", stance: "critico" },
        },
      },
      store,
    });

    const started = [];
    const finished = [];
    const created = await engine.openCase({
      topic: "¿Añadir ronda de réplica?",
      debateRounds: 0,
      onAgentStart: (ev) => started.push(ev.agent),
      onAgentDone: (ev) => finished.push(ev),
    });

    assert.equal(started.length, 2);
    assert.equal(finished.length, 2);
    assert.equal(typeof created.rounds[0].entries[0].durationMs, "number");

    const promptForReply = buildPrompt({
      session: created,
      agent: createAgent("sim1", { type: "mock" }),
      roundType: "debate",
    });
    assert.match(promptForReply, /Argumentos \(extracto\):/);

    const debated = await engine.debateCase({ sessionId: created.id });
    assert.equal(debated.rounds.length, 2);
    assert.equal(debated.rounds[1].type, "debate");
    assert.equal(debated.status, "dormida");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("renderRichLines ajusta líneas largas al ancho indicado y conserva listas", () => {
  const text = "Esta es una línea muy larga con **texto en negrita** y `codigo_inline` que debe dividirse en varias líneas legibles.\n- Primer punto con texto suficientemente largo para envolver";
  const lines = renderRichLines(text, { width: 42, output: { isTTY: false } });
  assert.ok(lines.length >= 4);
  for (const line of lines) {
    assert.ok(line.length <= 46, `Línea demasiado larga (${line.length}): ${line}`);
  }
  const joined = lines.join(" ");
  assert.ok(joined.includes("texto en negrita"));
  assert.ok(!joined.includes("**"));
  assert.ok(lines.some((l) => l.includes("• Primer punto")));
});

test("servidor MCP comparte lock entre llamadas concurrentes y expone debatir_caso", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-mcplock-test-"));
  const configPath = path.join(tempDir, "tribunal.config.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        sessionsDir: path.join(tempDir, "sessions"),
        defaultAgents: ["sim1"],
        agents: { sim1: { type: "mock", stance: "critico" } },
      },
      null,
      2,
    ),
  );

  const serverPath = path.resolve("src/mcp/server.js");
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, TRIBUNAL_CONFIG: configPath },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pending = new Map();
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const resolver = pending.get(msg.id);
      if (resolver) {
        pending.delete(msg.id);
        resolver(msg);
      }
    }
  });

  const rpc = (id, method, params = {}) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout esperando ${method}`)), 5000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  try {
    await rpc(1, "initialize", { protocolVersion: "2024-11-05" });
    const toolsRes = await rpc(2, "tools/list");
    assert.ok(toolsRes.result.tools.some((t) => t.name === "debatir_caso"));

    const openRes = await rpc(3, "tools/call", {
      name: "abrir_caso",
      arguments: { topic: "Lock en MCP", debateRounds: 0 },
    });
    const sessionId = openRes.result.content[0].text.match(/caso-\d{8}-[a-f0-9]{6}/)[0];

    await Promise.all([
      rpc(4, "tools/call", {
        name: "cuestionar_caso",
        arguments: { sessionId, objection: "Objeción MCP 1" },
      }),
      rpc(5, "tools/call", {
        name: "cuestionar_caso",
        arguments: { sessionId, objection: "Objeción MCP 2" },
      }),
    ]);

    const debateRes = await rpc(6, "tools/call", {
      name: "debatir_caso",
      arguments: { sessionId },
    });
    const finalText = debateRes.result.content[0].text;
    assert.match(finalText, /Objeción MCP 1/);
    assert.match(finalText, /Objeción MCP 2/);
    assert.match(finalText, /Ronda 4 · DEBATE/);
  } finally {
    child.kill("SIGTERM");
    await rm(tempDir, { recursive: true, force: true });
  }
});
