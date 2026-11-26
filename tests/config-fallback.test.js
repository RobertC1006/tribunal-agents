import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import { editConfig } from "../src/config/configEditor.js";
import { loadConfig, resolveConfigPath } from "../src/config/loadConfig.js";

test("loadConfig cae a tribunal.config.default.json cuando no existe tribunal.config.json y prioriza el personal si existe", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tribunal-cfg-fallback-"));
  try {
    const defaultPath = path.join(dir, "tribunal.config.default.json");
    const localPath = path.join(dir, "tribunal.config.json");

    await writeFile(
      defaultPath,
      JSON.stringify({
        sessionsDir: "./sessions",
        defaultAgents: ["sim1"],
        agents: { sim1: { type: "mock", stance: "cauteloso" } },
      }),
    );

    const resolvedDefault = await resolveConfigPath({ baseDir: dir, env: {} });
    assert.equal(resolvedDefault, defaultPath);

    const cfgDefault = await loadConfig(undefined, { baseDir: dir, env: {} });
    assert.deepEqual(cfgDefault.defaultAgents, ["sim1"]);

    await writeFile(
      localPath,
      JSON.stringify({
        sessionsDir: "./sessions",
        defaultAgents: ["codex"],
        agents: { codex: { type: "codex" } },
      }),
    );

    const resolvedLocal = await resolveConfigPath({ baseDir: dir, env: {} });
    assert.equal(resolvedLocal, localPath);

    const cfgLocal = await loadConfig(undefined, { baseDir: dir, env: {} });
    assert.deepEqual(cfgLocal.defaultAgents, ["codex"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig falla de forma explícita si TRIBUNAL_CONFIG apunta a un archivo inexistente", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tribunal-cfg-env-"));
  try {
    await assert.rejects(
      loadConfig(undefined, {
        baseDir: dir,
        env: { TRIBUNAL_CONFIG: path.join(dir, "no-existe.json") },
      }),
      /ENOENT/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("configurar en un clon limpio lee del archivo default y crea tribunal.config.json sin tocar el default", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tribunal-cfg-clean-"));
  try {
    const defaultPath = path.join(dir, "tribunal.config.default.json");
    const localPath = path.join(dir, "tribunal.config.json");
    const initialDefault = {
      sessionsDir: "./sessions",
      defaultAgents: ["mock-critic"],
      agents: {
        "mock-critic": { type: "mock", stance: "critico" },
        claude: { type: "claude", command: "claude", timeoutMs: 180000 },
      },
    };
    await writeFile(defaultPath, JSON.stringify(initialDefault, null, 2));

    // Selecciona opción 3 (participantes predeterminados) -> claude -> 0 salir
    const input = Readable.from(["3\nclaude\n0\n"]);
    const output = new PassThrough();
    await editConfig({ configPath: localPath, fallbackPath: defaultPath, input, output });

    const savedLocal = JSON.parse(await readFile(localPath, "utf8"));
    assert.deepEqual(savedLocal.defaultAgents, ["claude"]);

    const untouchedDefault = JSON.parse(await readFile(defaultPath, "utf8"));
    assert.deepEqual(untouchedDefault, initialDefault);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
