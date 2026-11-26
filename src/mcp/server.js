#!/usr/bin/env node
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/loadConfig.js";
import { TribunalEngine } from "../engine/tribunalEngine.js";
import { SessionStore } from "../sessions/sessionStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, "../../tribunal.config.json");

const TOOLS = [
  {
    name: "abrir_caso",
    description:
      "Convoca al Tribunal de Agentes para debatir una decisión técnica. Si pasas workspaceDir, los agentes CLI investigan el código real del proyecto en modo solo lectura antes de opinar.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Pregunta o decisión técnica a debatir." },
        context: { type: "string", description: "Contexto o restricciones adicionales." },
        workspaceDir: {
          type: "string",
          description: "Ruta absoluta del proyecto que los agentes pueden leer e investigar (solo lectura).",
        },
        agents: {
          type: "array",
          items: { type: "string" },
          description: "Nombres de perfiles de tribunal.config.json (opcional; usa los predeterminados).",
        },
        debateRounds: {
          type: "integer",
          minimum: 0,
          maximum: 5,
          description: "Número de rondas de debate tras la apertura ciega (por defecto 1).",
        },
        timeoutSec: {
          type: "integer",
          minimum: 1,
          maximum: 3600,
          description: "Timeout por agente en segundos (opcional; por defecto 90s o 300s con workspaceDir).",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "cuestionar_caso",
    description:
      "Despierta una sesión dormida del Tribunal con una objeción o repregunta del usuario/juez y recoge las nuevas posturas.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "ID del caso (ej. caso-20261126-a1b2c3)." },
        objection: { type: "string", description: "Objeción, restricción nueva o pregunta para los magistrados." },
        targetAgents: {
          type: "array",
          items: { type: "string" },
          description: "Subconjunto de agentes a consultar (opcional; por defecto todos los del caso).",
        },
      },
      required: ["sessionId", "objection"],
    },
  },
  {
    name: "debatir_caso",
    description:
      "Lanza una ronda adicional de réplica/debate sobre un caso guardado para que los magistrados lean las posturas recientes y debatan entre sí.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "ID del caso a redebatir." },
        targetAgents: {
          type: "array",
          items: { type: "string" },
          description: "Subconjunto de agentes participantes (opcional).",
        },
        timeoutSec: {
          type: "integer",
          minimum: 1,
          maximum: 3600,
          description: "Timeout por agente en segundos (opcional).",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "inspeccionar_caso",
    description: "Lee el acta completa de una sesión guardada en disco sin llamar a ninguna IA (0 tokens).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "ID de la sesión a inspeccionar." },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "listar_casos",
    description: "Lista todas las sesiones guardadas del Tribunal (ID, estado, rondas y tema).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "listar_agentes",
    description: "Muestra los perfiles de agentes y modelos configurados en tribunal.config.json.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

function getConfigPath() {
  return process.env.TRIBUNAL_CONFIG
    ? path.resolve(process.env.TRIBUNAL_CONFIG)
    : DEFAULT_CONFIG_PATH;
}

let sharedRuntime = null;

async function getRuntime() {
  const config = await loadConfig(getConfigPath());
  if (!sharedRuntime) {
    const store = new SessionStore(config.sessionsDir);
    const engine = new TribunalEngine({ config, store });
    sharedRuntime = { config, store, engine };
  } else {
    sharedRuntime.config = config;
    sharedRuntime.store.sessionsDir = config.sessionsDir;
    sharedRuntime.engine.config = config;
  }
  return sharedRuntime;
}

function formatSessionForMcp(session, store) {
  const lines = [
    `⚖️ **TRIBUNAL DE AGENTES · ${session.id}** (\`${session.status}\`)`,
    `> **Tema:** ${session.topic}`,
  ];
  if (session.context) lines.push(`> **Contexto:** ${session.context}`);
  if (session.workspaceDir) lines.push(`> **Proyecto investigado:** \`${session.workspaceDir}\``);
  lines.push(`> **Magistrados:** ${session.agents.join(", ")}`);
  lines.push("");

  for (const round of session.rounds) {
    lines.push(`### ══ Ronda ${round.number} · ${round.type.toUpperCase()} ══`);
    if (round.userObjection) {
      lines.push(`> **Objeción del juez:** ${round.userObjection}`);
    }
    lines.push("");
    for (const entry of round.entries) {
      const role = entry.role ? ` _(${entry.role})_` : "";
      lines.push(`#### ▸ \`${entry.agent}\`${role}`);
      if (entry.error) {
        lines.push(`- **Error:** ${entry.error}`);
      } else {
        lines.push(`- **Resumen:** ${entry.summary ?? entry.resumen ?? ""}`);
        lines.push(`- **Disidencias:** ${entry.dissents ?? entry.disidencias ?? ""}`);
        lines.push(`- **Argumentos:** ${entry.reasoning ?? entry.razonamiento ?? ""}`);
      }
      lines.push("");
    }
  }

  lines.push(`---`);
  lines.push(`**Acta guardada:** \`${store.getMarkdownPath(session.id)}\``);
  return lines.join("\n");
}

async function handleToolCall(name, args = {}) {
  const { config, store, engine } = await getRuntime();

  if (name === "abrir_caso") {
    if (!args.topic || typeof args.topic !== "string") {
      throw new Error("El argumento 'topic' es obligatorio.");
    }
    const session = await engine.openCase({
      topic: args.topic,
      context: args.context || "",
      workspaceDir: args.workspaceDir || "",
      agents: args.agents,
      ...(args.debateRounds !== undefined ? { debateRounds: args.debateRounds } : {}),
      ...(args.timeoutSec !== undefined ? { timeoutMs: args.timeoutSec * 1000 } : {}),
    });
    return formatSessionForMcp(session, store);
  }

  if (name === "cuestionar_caso") {
    if (!args.sessionId || !args.objection) {
      throw new Error("Los argumentos 'sessionId' y 'objection' son obligatorios.");
    }
    const session = await engine.challengeCase({
      sessionId: args.sessionId,
      objection: args.objection,
      targetAgents: args.targetAgents,
    });
    return formatSessionForMcp(session, store);
  }

  if (name === "debatir_caso") {
    if (!args.sessionId) {
      throw new Error("El argumento 'sessionId' es obligatorio.");
    }
    const session = await engine.debateCase({
      sessionId: args.sessionId,
      targetAgents: args.targetAgents,
      ...(args.timeoutSec !== undefined ? { timeoutMs: args.timeoutSec * 1000 } : {}),
    });
    return formatSessionForMcp(session, store);
  }

  if (name === "inspeccionar_caso") {
    if (!args.sessionId) {
      throw new Error("El argumento 'sessionId' es obligatorio.");
    }
    const session = await engine.inspectCase(args.sessionId);
    return formatSessionForMcp(session, store);
  }

  if (name === "listar_casos") {
    const cases = await engine.listCases();
    if (!cases.length) return "⚖️ **TRIBUNAL DE AGENTES** — No hay sesiones guardadas todavía.";
    const rows = cases.map(
      (c) => `- \`${c.id}\` [${c.status}] · **${c.roundsCount} rondas** · ${c.topic}`
    );
    return `⚖️ **TRIBUNAL DE AGENTES · Sesiones (${cases.length})**\n\n${rows.join("\n")}`;
  }

  if (name === "listar_agentes") {
    const rows = Object.entries(config.agents).map(([agentName, cfg]) => {
      const def = config.defaultAgents.includes(agentName) ? " ★ predeterminado" : "";
      const model = cfg.model ? ` (${cfg.model})` : "";
      return `- \`${agentName}\` [${cfg.type}]${model}${def}`;
    });
    return `⚖️ **TRIBUNAL DE AGENTES · Perfiles configurados**\n\n${rows.join("\n")}`;
  }

  throw new Error(`Herramienta desconocida: "${name}".`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRequest(msg) {
  const { id, method, params } = msg;

  // Notificaciones (sin id) no llevan respuesta JSON-RPC
  if (id === undefined) return;

  try {
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "agent-tribunal", version: "0.1.0" },
        },
      });
      return;
    }

    if (method === "ping") {
      send({ jsonrpc: "2.0", id, result: {} });
      return;
    }

    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      try {
        const text = await handleToolCall(toolName, toolArgs);
        send({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text }] },
        });
      } catch (toolError) {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Error en ${toolName}: ${toolError.message}` }],
            isError: true,
          },
        });
      }
      return;
    }

    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Método no soportado: ${method}` },
    });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: error.message || "Error interno del servidor MCP." },
    });
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  handleRequest(msg);
});
