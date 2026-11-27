import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/api/createApp.js";
import { loadRuntime } from "../src/config/runtime.js";

async function withDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tribunal-runtime-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// CLI falso: responde al instante, salvo en un cuestionamiento, donde tarda `slowMs`.
// Al arrancar deja su PID en `pidFile` para comprobar luego si sigue vivo.
async function slowCli(dir, slowMs, pidFile) {
  const file = path.join(dir, "lento");
  await writeFile(
    file,
    `#!/usr/bin/env node
require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
const slow = process.argv.join(" ").includes("CUESTIONAMIENTO");
setTimeout(() => console.log("RESUMEN: listo"), slow ? ${slowMs} : 0);
`,
  );
  await chmod(file, 0o755);
  return file;
}

async function writeConfig(configPath, config) {
  await writeFile(configPath, JSON.stringify(config, null, 2));
}

function startMcp(configPath) {
  const child = spawn(process.execPath, [path.resolve("src/mcp/server.js")], {
    env: { ...process.env, TRIBUNAL_CONFIG: configPath },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  const responses = [];
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines.filter((l) => l.trim())) {
      const msg = JSON.parse(line);
      responses.push(msg);
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  });
  const notify = (method, params = {}) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  const rpc = (id, method, params = {}) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout esperando ${method}`)), 8000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const call = (id, name, args) => rpc(id, "tools/call", { name, arguments: args });
  return { child, rpc, call, notify, responses };
}

const caseId = (res) => res.result.content[0].text.match(/caso-\d{8}-[a-f0-9]{6}/)[0];
const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("MCP: cancelar una llamada detiene a los agentes y no envía respuesta", async () => {
  await withDir(async (dir) => {
    const pidFile = path.join(dir, "pid");
    const configPath = path.join(dir, "tribunal.config.json");
    await writeConfig(configPath, {
      sessionsDir: path.join(dir, "sessions"),
      defaultAgents: ["lento"],
      agents: { lento: { type: "claude", command: await slowCli(dir, 60_000, pidFile) } },
    });
    const mcp = startMcp(configPath);
    try {
      const opened = await mcp.call(1, "abrir_caso", { topic: "Tema", debateRounds: 0 });
      await rm(pidFile);
      mcp.call(2, "cuestionar_caso", { sessionId: caseId(opened), objection: "¿Y?" }).catch(() => {});
      while (!(await readFile(pidFile, "utf8").catch(() => ""))) await new Promise((r) => setTimeout(r, 20));
      const pid = Number(await readFile(pidFile, "utf8"));
      mcp.notify("notifications/cancelled", { requestId: 2, reason: "el usuario canceló" });
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(isAlive(pid), false, "el agente siguió vivo tras cancelar");
      await mcp.rpc(3, "ping");
      assert.equal(mcp.responses.some((m) => m.id === 2), false, "no debe responder a una llamada cancelada");
    } finally {
      mcp.child.kill("SIGTERM");
    }
  });
});

test("MCP: abrir_caso y cuestionar_caso aceptan imágenes, y cuestionar_caso acepta timeoutSec", async () => {
  await withDir(async (dir) => {
    const image = path.join(dir, "captura.png");
    await writeFile(image, "png");
    const sessionsDir = path.join(dir, "sessions");
    const configPath = path.join(dir, "tribunal.config.json");
    await writeConfig(configPath, { sessionsDir, defaultAgents: ["sim"], agents: { sim: { type: "mock" } } });
    const mcp = startMcp(configPath);
    try {
      const opened = await mcp.call(1, "abrir_caso", { topic: "Tema", debateRounds: 0, images: [image] });
      assert.equal(opened.result.isError, undefined, opened.result.content[0].text);
      const id = caseId(opened);
      const challenged = await mcp.call(2, "cuestionar_caso", { sessionId: id, objection: "¿Y?", images: [image], timeoutSec: 30 });
      assert.equal(challenged.result.isError, undefined, challenged.result.content[0].text);
      const saved = JSON.parse(await readFile(path.join(sessionsDir, `${id}.json`), "utf8"));
      assert.deepEqual(saved.images, [image]);
      assert.deepEqual(saved.rounds[1].images, [image]);
    } finally {
      mcp.child.kill("SIGTERM");
    }
  });
});

test("MCP: cambiar sessionsDir mientras corre una ronda no hace que esa ronda se pierda", async () => {
  await withDir(async (dir) => {
    const sessionsDir = path.join(dir, "sessions");
    const configPath = path.join(dir, "tribunal.config.json");
    const config = {
      sessionsDir,
      defaultAgents: ["lento"],
      agents: { lento: { type: "claude", command: await slowCli(dir, 800, path.join(dir, "pid")) } },
    };
    await writeConfig(configPath, config);
    const mcp = startMcp(configPath);
    try {
      const id = caseId(await mcp.call(1, "abrir_caso", { topic: "Tema", debateRounds: 0 }));
      const challenge = mcp.call(2, "cuestionar_caso", { sessionId: id, objection: "¿Y?" });
      await new Promise((r) => setTimeout(r, 200));
      await writeConfig(configPath, { ...config, sessionsDir: path.join(dir, "otra") });
      await mcp.call(3, "listar_casos", {});
      const res = await challenge;
      assert.equal(res.result.isError, undefined, res.result.content[0].text);
      const saved = JSON.parse(await readFile(path.join(sessionsDir, `${id}.json`), "utf8"));
      assert.equal(saved.rounds.length, 2);
    } finally {
      mcp.child.kill("SIGTERM");
    }
  });
});

test("web: un perfil añadido a la configuración se puede usar sin reiniciar el servidor", async () => {
  await withDir(async (dir) => {
    const configPath = path.join(dir, "tribunal.config.json");
    const config = { sessionsDir: path.join(dir, "sessions"), defaultAgents: ["sim"], agents: { sim: { type: "mock" } } };
    await writeConfig(configPath, config);
    const previous = process.env.TRIBUNAL_CONFIG;
    process.env.TRIBUNAL_CONFIG = configPath;
    const server = await new Promise((resolve) => {
      const instance = createApp({ loadRuntime }).listen(0, "127.0.0.1", () => resolve(instance));
    });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      await writeConfig(configPath, { ...config, agents: { ...config.agents, nuevo: { type: "mock" } } });
      const agents = await (await fetch(`${base}/api/agentes`)).json();
      assert.ok(agents.data.agents.some((a) => a.name === "nuevo"), "el perfil nuevo no aparece");
      const res = await fetch(`${base}/api/casos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: "Tema", agents: ["nuevo"], debateRounds: 0 }),
      });
      assert.equal(res.status, 201, JSON.stringify(await res.json()));
    } finally {
      await new Promise((resolve) => server.close(resolve));
      if (previous === undefined) delete process.env.TRIBUNAL_CONFIG;
      else process.env.TRIBUNAL_CONFIG = previous;
    }
  });
});
