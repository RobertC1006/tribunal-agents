import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createAgent } from "../src/agents/registry.js";

// Ollama falso: `handler` decide qué responde a /api/generate.
async function withOllama(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const agent = createAgent("ollama", {
    type: "ollama",
    model: "falso",
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  });
  try {
    await fn(agent);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const hang = () => {}; // Nunca responde.

test("Ollama: un error HTTP se informa tal cual, no como fallo de conexión", async () => {
  await withOllama(
    (_req, res) => res.writeHead(404).end('{"error":"model not found"}'),
    async (agent) => {
      await assert.rejects(agent.ask({ prompt: "hola" }), (error) => {
        assert.match(error.message, /HTTP 404.*model not found/);
        assert.doesNotMatch(error.message, /No se pudo conectar/);
        return true;
      });
    },
  );
});

test("Ollama: si el usuario cancela, el error dice cancelada y no Timeout", async () => {
  await withOllama(hang, async (agent) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(agent.ask({ prompt: "hola", timeoutMs: 5000, signal: controller.signal }), (error) => {
      assert.equal(error.name, "AbortError");
      assert.match(error.message, /cancelad/);
      assert.doesNotMatch(error.message, /Timeout/);
      return true;
    });
  });
});

test("Ollama: si se acaba el tiempo, el error dice Timeout", async () => {
  await withOllama(hang, async (agent) => {
    await assert.rejects(agent.ask({ prompt: "hola", timeoutMs: 100 }), /Timeout \(100ms\)/);
  });
});

test("Ollama: una respuesta vacía es un error, no una respuesta en blanco", async () => {
  await withOllama(
    (_req, res) => res.writeHead(200, { "content-type": "application/json" }).end('{"response":"  "}'),
    async (agent) => {
      await assert.rejects(agent.ask({ prompt: "hola" }), /sin respuesta/);
    },
  );
});

test("Ollama: sin servidor, el error sigue diciendo que no se pudo conectar", async () => {
  const agent = createAgent("ollama", { type: "ollama", model: "falso", baseUrl: "http://127.0.0.1:1" });
  await assert.rejects(agent.ask({ prompt: "hola" }), /No se pudo conectar con Ollama/);
});
