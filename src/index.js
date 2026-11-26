#!/usr/bin/env node
import { loadConfig } from "./config/loadConfig.js";
import { editConfig, printAgents } from "./config/configEditor.js";
import { TribunalEngine } from "./engine/tribunalEngine.js";
import { SessionStore } from "./sessions/sessionStore.js";
import {
  agentColor,
  agentOptions,
  askLine,
  banner,
  colorize,
  divider,
  select,
  TRIBUNAL_GOLD,
} from "./terminal.js";

const ROUND_COLORS = {
  apertura: 96,
  debate: TRIBUNAL_GOLD,
  cuestionamiento: 95,
};

/**
 * Interfaz CLI para interactuar con TribunalEngine.
 * Ejecuta `pnpm start` sin argumentos en una terminal interactiva para abrir el menú principal.
 */
async function main() {
  const [command, ...args] = process.argv.slice(2);
  const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (!command) {
    if (isInteractive) {
      await runMainMenu();
      return;
    }
    printHelp();
    return;
  }

  const config = await loadConfig();
  if (command === "configurar") return editConfig();
  if (command === "agentes") {
    console.log(`\n${divider("Agentes configurados", 96)}\n`);
    printAgents(config);
    console.log();
    return;
  }

  const store = new SessionStore(config.sessionsDir);
  const engine = new TribunalEngine({ config, store });

  if (command === "abrir") {
    await handleAbrir({ args, config, engine, store, isInteractive });
    return;
  }

  if (command === "cuestionar") {
    await handleCuestionar({ args, config, engine, store, isInteractive });
    return;
  }

  if (command === "ver") {
    await handleVer({ args, config, engine, isInteractive });
    return;
  }

  if (command === "listar") {
    await handleListar({ engine });
    return;
  }

  throw new Error(`Comando desconocido: "${command}". Usa "pnpm start help".`);
}

async function runMainMenu() {
  console.log(`\n${banner("⚖️  Agent Tribunal", "Debate local multi-agente · sesiones auditables")}\n`);

  while (true) {
    const config = await loadConfig();
    const store = new SessionStore(config.sessionsDir);
    const engine = new TribunalEngine({ config, store });
    const cases = await engine.listarCasos();

    const action = await select("¿Qué quieres hacer?", [
      { value: "abrir", label: "Abrir nuevo caso", detail: `${config.defaultAgents.join(", ")}`, color: 96 },
      { value: "ver", label: "Ver o cuestionar un caso", detail: `${cases.length} guardados`, color: 93 },
      { value: "agentes", label: "Ver agentes configurados", detail: `${Object.keys(config.agents).length} perfiles`, color: 92 },
      { value: "configurar", label: "Configurar modelos y perfiles", detail: "añadir, cambiar o eliminar", color: 95 },
      { value: "salir", label: "Salir", color: 90 },
    ]);

    if (!action || action === "salir") return;

    if (action === "abrir") {
      await handleAbrir({ args: [], config, engine, store, isInteractive: true });
    } else if (action === "ver") {
      const session = await handleVer({ args: [], config, engine, isInteractive: true });
      if (session) {
        const next = await select(`Caso ${session.id}`, [
          { value: "cuestionar", label: "Añadir cuestionamiento", detail: "despierta la sesión con tu objeción", color: 95 },
          { value: "volver", label: "Volver al menú", color: 90 },
        ]);
        if (next === "cuestionar") {
          await handleCuestionar({ args: [session.id], config, engine, store, isInteractive: true });
        }
      }
    } else if (action === "agentes") {
      console.log(`\n${divider("Agentes configurados", 96)}\n`);
      printAgents(config);
      console.log();
    } else if (action === "configurar") {
      await editConfig();
    }
  }
}

async function handleAbrir({ args, config, engine, store, isInteractive }) {
  let [topic, context = "", agentsCsv, debateRounds = "1", workspaceDir = ""] = args;
  let agents = parseAgentNames(agentsCsv);

  if (!args.length && isInteractive) {
    topic = await askLine("Tema del caso (Enter para volver):");
    if (!topic) return;
    context = await askLine("Contexto (opcional):");
    if (context === undefined) return;
    workspaceDir = await askLine("Ruta del código a investigar en solo lectura (Enter para omitir):");
    if (workspaceDir === undefined) return;
    agents = await select(
      "Participantes del caso",
      agentOptions(config.agents, config.defaultAgents),
      { selected: config.defaultAgents, multiple: true }
    );
    if (!agents) return;
    debateRounds = await askLine("Rondas de debate [1]:");
    if (debateRounds === undefined) return;
    debateRounds ||= "1";
  }

  if (!topic) {
    throw new Error('Debes indicar un tema. Ej: pnpm start abrir "¿SQLite o Postgres?"');
  }

  const chosen = agents.length ? agents : config.defaultAgents;
  const sub = [context, workspaceDir ? `Proyecto: ${workspaceDir}` : "", `Magistrados: ${chosen.join(", ")}`]
    .filter(Boolean)
    .join(" · ");
  console.log(`\n${banner(`⚖️  TRIBUNAL · ${topic}`, sub)}\n`);

  const session = await engine.abrirCaso({
    topic,
    context,
    workspaceDir,
    agents,
    debateRounds: /^\d+$/.test(debateRounds) ? Number(debateRounds) : NaN,
    onRound: (round) => printRound(round, config.agents),
  });
  printSavedSession(session, store);
}

async function handleCuestionar({ args, config, engine, store, isInteractive }) {
  let [sessionId, objection, agentsCsv] = args;
  let targetAgents = parseAgentNames(agentsCsv);

  if (!sessionId && isInteractive) {
    sessionId = await pickSession(engine, "Elige el caso a cuestionar");
    if (!sessionId) return;
  }

  if (sessionId && !objection && isInteractive) {
    objection = await askLine("Tu objeción o pregunta como juez (Enter para volver):");
    if (!objection) return;
    const session = await engine.inspeccionarCaso(sessionId);
    const sessionAgents = Object.fromEntries(
      session.agents.map((name) => [name, config.agents[name] || { type: "agente" }])
    );
    targetAgents = await select(
      "¿A qué agentes dirigir el cuestionamiento?",
      agentOptions(sessionAgents, session.agents),
      { selected: session.agents, multiple: true }
    );
    if (!targetAgents) return;
  }

  if (!sessionId || !objection) {
    throw new Error('Uso: pnpm start cuestionar <sessionId> "<tu objeción>" [agente1,agente2]');
  }

  console.log(`\n${divider(`Reabriendo ${sessionId}`, 95)}\n`);
  const session = await engine.cuestionarCaso({
    sessionId,
    objection,
    targetAgents,
    onRound: (round) => printRound(round, config.agents),
  });
  printSavedSession(session, store);
}

async function handleVer({ args, config, engine, isInteractive }) {
  let [sessionId] = args;
  if (!sessionId && isInteractive) {
    sessionId = await pickSession(engine, "Elige un caso guardado");
    if (!sessionId) return null;
  }
  if (!sessionId) {
    throw new Error("Uso: pnpm start ver <sessionId>");
  }

  const session = await engine.inspeccionarCaso(sessionId);
  console.log(
    `\n${banner(`Caso ${session.id} · ${session.status}`, session.topic)}`
  );
  if (session.context) {
    console.log(`${colorize("Contexto:", "1;90")} ${session.context}`);
  }
  session.rounds.forEach((round) => printRound(round, config.agents));
  console.log();
  return session;
}

async function handleListar({ engine }) {
  const cases = await engine.listarCasos();
  if (!cases.length) {
    console.log(colorize("\nNo hay sesiones guardadas todavía.\n", 90));
    return;
  }
  console.log(`\n${divider(`Sesiones guardadas (${cases.length})`, 96)}\n`);
  for (const item of cases) {
    const statusColor = item.status === "activa" ? 92 : 90;
    const pill = colorize(`[${item.status}]`, statusColor);
    const rounds = colorize(`${item.roundsCount} rondas`, 93);
    console.log(`  ${colorize(item.id, "1;96")} ${pill} ${colorize("·", 90)} ${rounds}`);
    console.log(`    ${item.topic}\n`);
  }
}

async function pickSession(engine, title) {
  const cases = await engine.listarCasos();
  if (!cases.length) {
    console.log(colorize("\nNo hay sesiones guardadas todavía.\n", 90));
    return undefined;
  }
  return select(
    title,
    cases.map((item) => ({
      value: item.id,
      label: item.topic,
      badge: `${item.roundsCount}r`,
      detail: `${item.id} · ${item.status}`,
      color: item.status === "activa" ? 92 : 96,
    }))
  );
}

function parseAgentNames(names = "") {
  return names.split(",").map((name) => name.trim()).filter(Boolean);
}

function printSavedSession(session, store) {
  console.log(`\n${divider("Sesión guardada", 92)}`);
  console.log(`  ${colorize("ID:", "1;90")}   ${colorize(session.id, "1;96")} ${colorize(`(${session.status})`, 90)}`);
  console.log(`  ${colorize("Acta:", "1;90")} ${store.getMarkdownPath(session.id)}\n`);
}

function printRound(round, agents) {
  const roundColor = ROUND_COLORS[round.type] || 96;
  console.log(`\n${divider(`Ronda ${round.number} · ${round.type.toUpperCase()}`, roundColor)}`);
  if (round.userObjection) {
    console.log(`\n  ${colorize("Objeción del juez:", "1;95")} ${round.userObjection}`);
  }
  for (const entry of round.entries) {
    const color = agentColor(agents, entry.agent);
    const type = agents?.[entry.agent]?.type;
    const badge = type ? `${colorize(`[${type}]`, color)} ` : "";
    const name = colorize(entry.agent, `1;${color}`);
    const role = entry.role ? colorize(` · ${entry.role}`, 90) : "";
    const bar = colorize("│", color);

    console.log(`\n  ${colorize("╭─", color)} ${badge}${name}${role}`);
    if (entry.error) {
      console.log(`  ${colorize("│", 91)} ${colorize("Error:", "1;91")} ${entry.error}`);
    } else {
      console.log(`  ${bar} ${colorize("Resumen:", `1;${TRIBUNAL_GOLD}`)} ${entry.resumen}`);
      console.log(`  ${bar} ${colorize("Disidencias:", "1;93")} ${entry.disidencias}`);
      const reasoningLines = String(entry.razonamiento || "").split("\n");
      console.log(`  ${bar} ${colorize("Argumentos:", "1;90")} ${reasoningLines[0]}`);
      for (const extra of reasoningLines.slice(1)) {
        console.log(`  ${bar}   ${extra}`);
      }
    }
    console.log(`  ${colorize("╰──────────────────────────────", color)}`);
  }
}

function printHelp() {
  console.log(`
${banner("⚖️  Agent Tribunal", "CLI modular multi-agente")}

${colorize("Modo sencillo (menú interactivo):", "1;96")}
  pnpm start

${colorize("Comandos directos:", "1;93")}
  pnpm start abrir         ${colorize("(asistente interactivo)", 90)}
  pnpm start abrir "<tema>" "[contexto]" "[agente1,agente2]" [rondas]
  pnpm start listar        ${colorize("(sesiones guardadas)", 90)}
  pnpm start ver [id]      ${colorize("(inspecciona sin gastar tokens)", 90)}
  pnpm start cuestionar [id] "<objeción>" "[agentes]"
  pnpm start agentes       ${colorize("(lista perfiles con sus colores y modelos)", 90)}
  pnpm start configurar    ${colorize("(cambiar modelo, clonar, predeterminados o eliminar)", 90)}
`);
}

main().catch((error) => {
  console.error(`\n${colorize("Error:", "1;91")} ${error.message}`);
  process.exit(1);
});
