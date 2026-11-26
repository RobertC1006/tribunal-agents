import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runProcess } from "../src/agents/baseAgent.js";
import { createAgent } from "../src/agents/registry.js";
import { getDataDir, loadConfig } from "../src/config/loadConfig.js";

test("package.json expone binarios para npx (agent-tribunal, agent-tribunal-mcp, agent-tribunal-ui)", async () => {
  const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  assert.equal(pkg.bin["agent-tribunal"], "src/index.js");
  assert.equal(pkg.bin["agent-tribunal-mcp"], "src/mcp/server.js");
  assert.equal(pkg.bin["agent-tribunal-ui"], "src/api/server.js");
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes("tribunal.config.default.json"));
});

test("getDataDir y loadConfig usan TRIBUNAL_HOME o ~/.agent-tribunal cuando corre desde npx/node_modules", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "tribunal-home-test-"));
  const fakePkgDir = path.join(tempHome, "_npx", "agent-tribunal");
  const customHome = path.join(tempHome, "user-data");
  try {
    assert.equal(
      getDataDir({ baseDir: fakePkgDir, env: {} }),
      path.join(os.homedir(), ".agent-tribunal"),
    );
    assert.equal(
      getDataDir({ baseDir: fakePkgDir, env: { TRIBUNAL_HOME: customHome } }),
      customHome,
    );

    const cfg = await loadConfig(undefined, {
      env: { TRIBUNAL_HOME: customHome },
    });
    assert.equal(cfg.sessionsDir, path.join(customHome, "sessions"));
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("runProcess cancela inmediatamente un subproceso cuando se dispara AbortSignal", async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  setTimeout(() => controller.abort(), 80);

  await assert.rejects(
    runProcess({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      timeoutMs: 10000,
      killGraceMs: 60,
      signal: controller.signal,
    }),
    /cancelad|abort/i,
  );

  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 2000, `Debió cancelar rápido, tardó ${elapsed}ms`);
});

test("ClaudeAgent y CodexAgent aplican flags reales de solo lectura cuando readOnly es true", () => {
  const claude = createAgent("claude", { type: "claude", model: "sonnet" });
  assert.deepEqual(claude.buildArgs("hola", { readOnly: true }), [
    "-p",
    "--model",
    "sonnet",
    "--permission-mode",
    "plan",
    "hola",
  ]);

  const codex = createAgent("codex", { type: "codex", model: "gpt-5" });
  assert.deepEqual(codex.buildArgs("hola", [], { readOnly: true }), [
    "exec",
    "-m",
    "gpt-5",
    "-s",
    "read-only",
    "hola",
  ]);
});
