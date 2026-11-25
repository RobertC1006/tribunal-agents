#!/usr/bin/env node
import { loadConfig } from "./config/loadConfig.js";
import { editConfig, printAgents } from "./config/configEditor.js";
import { TribunalEngine } from "./engine/tribunalEngine.js";
import { SessionStore } from "./sessions/sessionStore.js";
import { agentColor, agentOptions, askLine, colorize, select } from "./terminal.js";

/**
 * Interfaz CLI mínima para interactuar con TribunalEngine.
 * En la siguiente etapa, el servidor MCP en src/mcp/ llamará exactamente
 * a las mismas funciones del motor.
 */
async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  const config = await loadConfig();
  if (command === "configurar") return editConfig();
  if (command === "agentes") return printAgents(config);

  const store = new SessionStore(config.sessionsDir);
  const engine = new TribunalEngine({ config, store });
  const showRound = (round) => printRound(round, config.agents);

  if (command === "abrir") {
    let [topic, context = "", agentsCsv, debateRounds = "1"] = args;
    let agents = parseAgentNames(agentsCsv);
    if (!args.length && process.stdin.isTTY && process.stdout.isTTY) {
      topic = await askLine("Tema del caso (Enter para volver):");
      if (!topic) return;
      context = await askLine("Contexto (opcional):");
      if (context === undefined) return;
      agents = await select("Participantes del caso", agentOptions(config.agents), {
        selected: config.defaultAgents,
        multiple: true,
      });
      if (!agents) return;
      debateRounds = await askLine("Rondas de debate [1]:");
      if (debateRounds === undefined) return;
      debateRounds ||= "1";
    }
    if (!topic) {
      throw new Error('Debes indicar un tema. Ej: pnpm start abrir "¿SQLite o Postgres?"');
    }

    console.log(`\n⚖️  Abriendo caso: "${topic}"...\n`);
    if (context) console.log(`Contexto: ${context}`);
    const session = await engine.abrirCaso({
      topic,
      context,
      agents,
      debateRounds: /^\d+$/.test(debateRounds) ? Number(debateRounds) : NaN,
      onRound: showRound,
    });
    printSavedSession(session, store);
    return;
  }

  if (command === "cuestionar") {
    const [sessionId, objection, agentsCsv] = args;
    if (!sessionId || !objection) {
      throw new Error(
        'Uso: pnpm start cuestionar <sessionId> "<tu objeción>" [agente1,agente2]'
      );
    }

    console.log(`\n⚡ Reabriendo sesión ${sessionId} con tu objeción...\n`);
    const session = await engine.cuestionarCaso({
      sessionId,
      objection,
      targetAgents: parseAgentNames(agentsCsv),
      onRound: showRound,
    });
    printSavedSession(session, store);
    return;
  }

  if (command === "ver") {
    const [sessionId] = args;
    if (!sessionId) {
      throw new Error("Uso: pnpm start ver <sessionId>");
    }
    const session = await engine.inspeccionarCaso(sessionId);
    console.log(`=== CASO ${session.id} (${session.status}) ===`);
    console.log(`Tema: ${session.topic}`);
    if (session.context) console.log(`Contexto: ${session.context}`);
    session.rounds.forEach(showRound);
    return;
  }

  if (command === "listar") {
    const cases = await engine.listarCasos();
    if (!cases.length) {
      console.log("No hay sesiones guardadas todavía.");
      return;
    }
    console.log("\n📂 Sesiones guardadas:\n");
    for (const item of cases) {
      console.log(
        `- ${item.id} | [${item.status}] | ${item.roundsCount} rondas | ${item.topic}`
      );
    }
    return;
  }

  throw new Error(`Comando desconocido: "${command}". Usa "pnpm start help".`);
}

function parseAgentNames(names = "") {
  return names.split(",").map((name) => name.trim()).filter(Boolean);
}

function printSavedSession(session, store) {
  console.log(`\nCaso ${session.id} (${session.status})`);
  console.log(`Acta: ${store.getMarkdownPath(session.id)}`);
}

function printRound(round, agents) {
  const heading = `Ronda ${round.number} · ${round.type.toUpperCase()}`;
  console.log(`\n${colorize(heading, 1)}`);
  if (round.userObjection) {
    console.log(`${colorize("Tu objeción", 1)}: ${round.userObjection}`);
  }
  for (const entry of round.entries) {
    const name = colorize(`[${entry.agent}]`, agentColor(agents, entry.agent));
    const role = entry.role ? ` (${entry.role})` : "";
    console.log(`\n${name}${role}`);
    if (entry.error) {
      console.log(`  ${colorize("Error", 31)}: ${entry.error}`);
    } else {
      console.log(`  Resumen: ${entry.resumen}`);
      console.log(`  Disidencias: ${entry.disidencias}`);
      console.log(`  Argumentos: ${entry.razonamiento}`);
    }
  }
}

function printHelp() {
  console.log(`
Tribunal de Agentes — CLI modular

Comandos disponibles:
  pnpm start abrir   (asistente interactivo)
  pnpm start abrir "<tema>" "[contexto opcional]" "[agente1,agente2]" [rondas de debate]
  pnpm start agentes
  pnpm start configurar
  pnpm start listar
  pnpm start ver <sessionId>
  pnpm start cuestionar <sessionId> "<tu objeción>" "[agente1,agente2]"
`);
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
