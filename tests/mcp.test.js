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

test("buildPrompt y TribunalEngine propagan workspaceDir para investigar código en modo solo lectura", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-ws-test-"));
  try {
    const prompt = buildPrompt({
      session: {
        topic: "Auditar arquitectura",
        context: "Revisar rutas HTTP",
        workspaceDir: tempDir,
        rounds: [],
      },
      agent: createAgent("codex", { type: "codex" }),
      roundType: "apertura",
    });

    assert.match(prompt, new RegExp(tempDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(prompt, /solo lectura|sin modificar archivos/i);

    const store = new SessionStore(tempDir);
    const engine = new TribunalEngine({
      config: {
        sessionsDir: tempDir,
        defaultAgents: ["sim1"],
        agents: { sim1: { type: "mock", stance: "critico" } },
      },
      store,
    });

    const session = await engine.openCase({
      topic: "Revisar módulo",
      workspaceDir: tempDir,
      debateRounds: 0,
    });

    assert.equal(session.workspaceDir, path.resolve(tempDir));
    const reloaded = await engine.inspectCase(session.id);
    assert.equal(reloaded.workspaceDir, path.resolve(tempDir));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("servidor MCP responde initialize, tools/list y ejecuta abrir_caso, listar_casos y cuestionar_caso", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-mcp-test-"));
  const configPath = path.join(tempDir, "tribunal.config.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        sessionsDir: path.join(tempDir, "sessions"),
        defaultAgents: ["sim1", "sim2"],
        agents: {
          sim1: { type: "mock", stance: "cauteloso" },
          sim2: { type: "mock", stance: "critico" },
        },
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
    const init = await rpc(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    assert.equal(init.result.serverInfo.name, "agent-tribunal");
    assert.ok(init.result.capabilities.tools);

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

    const toolsRes = await rpc(2, "tools/list");
    const toolNames = toolsRes.result.tools.map((t) => t.name).sort();
    assert.deepEqual(toolNames, [
      "abrir_caso",
      "cuestionar_caso",
      "debatir_caso",
      "inspeccionar_caso",
      "listar_agentes",
      "listar_casos",
    ]);

    const openRes = await rpc(3, "tools/call", {
      name: "abrir_caso",
      arguments: {
        topic: "¿Conviene usar MCP?",
        context: "Integración con agy, codex y claude",
        workspaceDir: tempDir,
        debateRounds: 1,
      },
    });
    assert.equal(openRes.result.isError, undefined);
    const openText = openRes.result.content[0].text;
    assert.match(openText, /TRIBUNAL DE AGENTES/i);
    const idMatch = openText.match(/caso-\d{8}-[a-f0-9]{6}/);
    assert.ok(idMatch, "Debe devolver el sessionId en la respuesta");

    const listRes = await rpc(4, "tools/call", { name: "listar_casos", arguments: {} });
    assert.match(listRes.result.content[0].text, new RegExp(idMatch[0]));

    const objRes = await rpc(5, "tools/call", {
      name: "cuestionar_caso",
      arguments: {
        sessionId: idMatch[0],
        objection: "¿Y el consumo de contexto?",
        targetAgents: ["sim2"],
      },
    });
    assert.match(objRes.result.content[0].text, /CUESTIONAMIENTO/i);
  } finally {
    child.kill("SIGTERM");
    await rm(tempDir, { recursive: true, force: true });
  }
});
