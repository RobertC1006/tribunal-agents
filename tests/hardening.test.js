import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseAgentOutput, runProcess } from "../src/agents/baseAgent.js";
import { createAgent } from "../src/agents/registry.js";
import { createApp } from "../src/api/createApp.js";
import { TribunalEngine } from "../src/engine/tribunalEngine.js";
import { SessionStore } from "../src/sessions/sessionStore.js";

test("parseAgentOutput soporta negritas, encabezados Markdown y listas sin falsos positivos", () => {
  const markdownOutput = [
    "## Resumen",
    "Usar SQLite local para consultas rápidas.",
    "",
    "- **DISIDENCIAS:** Difiero de mantener archivos JSON cuando haya búsquedas complejas.",
    "",
    "### 3. **Razonamiento**",
    "Resumen de la evaluación: SQLite evita escanear cientos de archivos.",
    "También mantiene cero dependencias de servidor.",
  ].join("\n");

  const parsed = parseAgentOutput(markdownOutput);
  assert.equal(parsed.summary, "Usar SQLite local para consultas rápidas.");
  assert.equal(
    parsed.dissents,
    "Difiero de mantener archivos JSON cuando haya búsquedas complejas.",
  );
  assert.equal(
    parsed.reasoning,
    "Resumen de la evaluación: SQLite evita escanear cientos de archivos.\nTambién mantiene cero dependencias de servidor.",
  );
});

test("parseAgentOutput soporta negritas con dos puntos dentro y fuera", () => {
  const boldOutput = [
    "**RESUMEN:** Mantener el motor desacoplado.",
    "**DISIDENCIAS**: Falta validar el formato del sessionId.",
    "**RAZONAMIENTO:**",
    "Separar el motor permite conectar CLI, HTTP y MCP sin duplicar lógica.",
  ].join("\n");

  const parsed = parseAgentOutput(boldOutput);
  assert.equal(parsed.summary, "Mantener el motor desacoplado.");
  assert.equal(parsed.dissents, "Falta validar el formato del sessionId.");
  assert.equal(
    parsed.reasoning,
    "Separar el motor permite conectar CLI, HTTP y MCP sin duplicar lógica.",
  );
});

test("los conectores CLI protegen prompts que empiezan con guion y ubican --model antes de -p en agy", () => {
  const claude = createAgent("claude", { type: "claude", model: "sonnet" });
  assert.deepEqual(claude.buildArgs("-tema"), ["-p", "--model", "sonnet", "--", "-tema"]);

  const codex = createAgent("codex", { type: "codex", model: "gpt-5" });
  assert.deepEqual(codex.buildArgs("-tema"), ["exec", "-m", "gpt-5", "--", "-tema"]);

  const agy = createAgent("agy", { type: "agy" });
  assert.deepEqual(agy.buildArgs("-tema"), ["-p=-tema"]);

  const agyWithModel = createAgent("agy", { type: "agy", model: "gemini-4-carbon-high" });
  assert.deepEqual(agyWithModel.buildArgs("hola"), [
    "--model",
    "gemini-4-carbon-high",
    "-p",
    "hola",
  ]);
  assert.deepEqual(agyWithModel.buildArgs("-tema"), [
    "--model",
    "gemini-4-carbon-high",
    "-p=-tema",
  ]);
});

test("runProcess fuerza SIGKILL si el proceso hijo ignora SIGTERM al vencer el timeout", async () => {
  await assert.rejects(
    runProcess({
      command: process.execPath,
      args: ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      timeoutMs: 80,
      killGraceMs: 60,
    }),
    /Timeout \(80ms\)/,
  );
});

test("SessionStore rechaza sessionId con path traversal o caracteres inválidos", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-store-test-"));
  try {
    const store = new SessionStore(tempDir);
    await assert.rejects(
      store.load("../tribunal.config"),
      (error) => error.code === "INVALID_SESSION_ID" && error.statusCode === 400,
    );
    await assert.rejects(
      store.load("sub/caso-1"),
      (error) => error.code === "INVALID_SESSION_ID" && error.statusCode === 400,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("API Express soporta debateRounds, expone model en /api/agentes y responde 400 en entradas inválidas", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-api-test-"));
  let server;

  try {
    const config = {
      sessionsDir: tempDir,
      defaultAgents: ["claude-sim", "codex-sim"],
      agents: {
        "claude-sim": { type: "mock", model: "sim-v1", stance: "cauteloso" },
        "codex-sim": { type: "mock", stance: "pragmatico" },
      },
    };
    const store = new SessionStore(tempDir);
    const engine = new TribunalEngine({ config, store });
    const app = createApp({ config, engine });

    server = await new Promise((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. GET /api/agentes expone el modelo configurado
    const agentsRes = await fetch(`${baseUrl}/api/agentes`);
    assert.equal(agentsRes.status, 200);
    const agentsJson = await agentsRes.json();
    const claudeInfo = agentsJson.data.agents.find((a) => a.name === "claude-sim");
    assert.equal(claudeInfo.model, "sim-v1");

    // 2. POST /api/casos respeta debateRounds: 2
    const createRes = await fetch(`${baseUrl}/api/casos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "¿SQLite o JSON?", debateRounds: 2 }),
    });
    assert.equal(createRes.status, 201);
    const createdJson = await createRes.json();
    assert.deepEqual(
      createdJson.data.rounds.map((r) => r.type),
      ["apertura", "debate", "debate"],
    );

    // 3. POST /api/casos con debateRounds inválido devuelve 400
    const badRoundsRes = await fetch(`${baseUrl}/api/casos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "Tema", debateRounds: -1 }),
    });
    assert.equal(badRoundsRes.status, 400);

    // 4. POST /api/casos con agente inexistente devuelve 400
    const badAgentRes = await fetch(`${baseUrl}/api/casos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "Tema", agents: ["no-existe"] }),
    });
    assert.equal(badAgentRes.status, 400);

    // 5. GET /api/casos/:sessionId con ID inválido devuelve 400
    const badIdRes = await fetch(`${baseUrl}/api/casos/..%2Ftribunal.config`);
    assert.equal(badIdRes.status, 400);

    // 6. JSON malformado devuelve 400
    const badJsonRes = await fetch(`${baseUrl}/api/casos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{json-invalido",
    });
    assert.equal(badJsonRes.status, 400);

    // 7. GET / sirve el visor web HTML
    const uiRes = await fetch(`${baseUrl}/`);
    assert.equal(uiRes.status, 200);
    assert.match(uiRes.headers.get("content-type") || "", /text\/html/);
    const html = await uiRes.text();
    assert.match(html, /<title>Tribunal Agents<\/title>/);
  } finally {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runProcess no rompe una letra con tilde que llega partida en dos trozos de salida", async () => {
  // "á" son dos bytes en UTF-8: se envía solo el primero, y el resto 150 ms después.
  const code = 'const b=Buffer.from("áñ");process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),150);';
  assert.equal(await runProcess({ command: process.execPath, args: ["-e", code] }), "áñ");
});

// fetch no garantiza enviar un Host propio; http.request sí.
function getStatus(port, hostHeader) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: "/api/casos", headers: { host: hostHeader } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on("error", reject);
  });
}

test("la API rechaza peticiones con un Host ajeno (DNS rebinding) y acepta los de loopback", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-host-test-"));
  const config = { sessionsDir: tempDir, defaultAgents: ["sim"], agents: { sim: { type: "mock" } } };
  const engine = new TribunalEngine({ config, store: new SessionStore(tempDir) });
  const server = await new Promise((resolve) => {
    const instance = createApp({ config, engine }).listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const { port } = server.address();
    assert.equal(await getStatus(port, "evil.example"), 403);
    assert.equal(await getStatus(port, `evil.example:${port}`), 403);
    assert.equal(await getStatus(port, `localhost:${port}`), 200);
    assert.equal(await getStatus(port, `127.0.0.1:${port}`), 200);
    assert.equal(await getStatus(port, `[::1]:${port}`), 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  }
});
