import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAgent } from "../src/agents/registry.js";
import { createApp } from "../src/api/createApp.js";
import { TribunalEngine } from "../src/engine/tribunalEngine.js";
import { buildPrompt } from "../src/sessions/contextBuilder.js";
import { SessionStore } from "../src/sessions/sessionStore.js";

// 1x1 PNG mínimo válido
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("CodexAgent pasa -i por cada imagen y buildPrompt incluye las rutas adjuntas", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-img-prompt-"));
  const imgPath = path.join(tempDir, "mockup.png");
  try {
    await writeFile(imgPath, Buffer.from(TINY_PNG_BASE64, "base64"));

    const codex = createAgent("codex", { type: "codex", model: "gpt-5" });
    assert.deepEqual(codex.buildArgs("hola", [imgPath]), [
      "exec",
      "-m",
      "gpt-5",
      "-i",
      imgPath,
      "hola",
    ]);

    const prompt = buildPrompt({
      session: { topic: "Revisar diseño", context: "", images: [imgPath], rounds: [] },
      agent: codex,
      roundType: "apertura",
    });
    assert.match(prompt, new RegExp(imgPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("TribunalEngine valida imágenes existentes, las guarda en sesión/ronda y rechaza rutas inexistentes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-img-engine-"));
  const imgPath = path.join(tempDir, "captura.png");
  try {
    await writeFile(imgPath, Buffer.from(TINY_PNG_BASE64, "base64"));
    const store = new SessionStore(tempDir);
    const engine = new TribunalEngine({
      config: {
        sessionsDir: tempDir,
        defaultAgents: ["sim1"],
        agents: { sim1: { type: "mock", stance: "cauteloso" } },
      },
      store,
    });

    await assert.rejects(
      engine.openCase({
        topic: "Imagen rota",
        images: [path.join(tempDir, "no-existe.png")],
        debateRounds: 0,
      }),
      (error) => error.statusCode === 400 && /imagen/i.test(error.message),
    );

    const session = await engine.openCase({
      topic: "Evaluar captura",
      images: [imgPath],
      debateRounds: 0,
    });
    assert.deepEqual(session.images, [imgPath]);

    const challenged = await engine.challengeCase({
      sessionId: session.id,
      objection: "Mira esta otra vista",
      images: [imgPath],
    });
    assert.deepEqual(challenged.rounds[1].images, [imgPath]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("API Express acepta imageUploads en base64, guarda adjuntos y los sirve en /api/casos/attachments/:file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tribunal-img-api-"));
  let server;
  try {
    const config = {
      sessionsDir: tempDir,
      defaultAgents: ["sim1"],
      agents: { sim1: { type: "mock", stance: "pragmatico" } },
    };
    const store = new SessionStore(tempDir);
    const engine = new TribunalEngine({ config, store });
    const app = createApp({ config, engine });

    server = await new Promise((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const res = await fetch(`${baseUrl}/api/casos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "Caso con captura",
        debateRounds: 0,
        imageUploads: [{ name: "ui.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` }],
      }),
    });
    assert.equal(res.status, 201);
    const created = (await res.json()).data;
    assert.equal(created.images.length, 1);

    const fileName = path.basename(created.images[0]);
    const imgRes = await fetch(`${baseUrl}/api/casos/attachments/${encodeURIComponent(fileName)}`);
    assert.equal(imgRes.status, 200);
    assert.match(imgRes.headers.get("content-type") || "", /image\/png/);
  } finally {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    await rm(tempDir, { recursive: true, force: true });
  }
});
