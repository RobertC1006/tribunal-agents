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
  createRoundProgress,
  divider,
  renderRichLines,
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
    await handleOpen({ args, config, engine, store, isInteractive });
    return;
  }

  if (command === "cuestionar") {
    await handleChallenge({ args, config, engine, store, isInteractive });
    return;
  }

  if (command === "debatir") {
    await handleDebate({ args, config, engine, store, isInteractive });
    return;
  }

  if (command === "ver") {
    await handleView({ args, config, engine, isInteractive });
    return;
  }

  if (command === "listar") {
    await handleList({ engine });
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
    const cases = await engine.listCases();

    const action = await select("¿Qué quieres hacer?", [
      { value: "abrir", label: "Abrir nuevo caso", detail: `${config.defaultAgents.join(", ")}`, color: 96 },
      { value: "ver", label: "Ver o cuestionar un caso", detail: `${cases.length} guardados`, color: 93 },
      { value: "agentes", label: "Ver agentes configurados", detail: `${Object.keys(config.agents).length} perfiles`, color: 92 },
      { value: "configurar", label: "Configurar modelos y perfiles", detail: "añadir, cambiar o eliminar", color: 95 },
      { value: "salir", label: "Salir", color: 90 },
    ]);

    if (!action || action === "salir") return;

    if (action === "abrir") {
      const session = await handleOpen({ args: [], config, engine, store, isInteractive: true });
      if (session) {
        await promptSessionFollowUp(session.id, { config, engine, store });
      }
    } else if (action === "ver") {
      const session = await handleView({ args: [], config, engine, isInteractive: true });
      if (session) {
        await promptSessionFollowUp(session.id, { config, engine, store });
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

async function promptSessionFollowUp(sessionId, { config, engine, store }) {
  while (true) {
    const next = await select(`¿Qué deseas hacer con ${sessionId}?`, [
      { value: "cuestionar", label: "Escribir cuestionamiento", detail: "envía una objeción o repregunta como juez", color: 95 },
      { value: "debatir", label: "Redebatir última ronda", detail: "los magistrados se replican entre sí", color: 93 },
      { value: "volver", label: "Dejar dormida y volver al menú", detail: "0 memoria · guardada en disco", color: 90 },
    ]);
    if (!next || next === "volver") return;
    if (next === "cuestionar") {
      await handleChallenge({ args: [sessionId], config, engine, store, isInteractive: true });
    } else if (next === "debatir") {
      await handleDebate({ args: [sessionId], config, engine, store, isInteractive: true });
    }
  }
}

async function withAbortOnSigint(fn) {
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once("SIGINT", onSigint);
  try {
    return await fn(controller.signal);
  } finally {
    process.off("SIGINT", onSigint);
  }
}

async function handleOpen({ args, config, engine, store, isInteractive }) {
  let [topic, context = "", agentsCsv, debateRounds = "1", workspaceDir = "", timeoutSec = ""] = args;
  let agents = parseAgentNames(agentsCsv);
  let images = [];

  if (!args.length && isInteractive) {
    topic = await askLine("Tema del caso (Enter para volver):");
    if (!topic) return null;
    context = await askLine("Contexto (opcional):");
    if (context === undefined) return null;
    workspaceDir = await askLine("Ruta del código a inspeccionar (Enter para omitir):");
    if (workspaceDir === undefined) return null;
    const imagesInput = await askLine("Imágenes adjuntas (rutas separadas por coma, Enter para omitir):");
    if (imagesInput === undefined) return null;
    images = parseImagePaths(imagesInput);
    agents = await select(
      "Participantes del caso",
      agentOptions(config.agents, config.defaultAgents),
      { selected: config.defaultAgents, multiple: true }
    );
    if (!agents) return null;
    debateRounds = await askLine("Rondas de debate [1]:");
    if (debateRounds === undefined) return null;
    debateRounds ||= "1";
    const defaultSec = workspaceDir ? "300" : "90";
    timeoutSec = await askLine(`Timeout por agente en segundos [${defaultSec}]:`);
    if (timeoutSec === undefined) return null;
  }

  if (!topic) {
    throw new Error('Debes indicar un tema. Ej: pnpm start abrir "¿SQLite o Postgres?"');
  }

  const parsedTimeoutMs = timeoutSec
    ? (/^\d+$/.test(timeoutSec) ? Number(timeoutSec) * 1000 : NaN)
    : undefined;

  const chosen = agents.length ? agents : config.defaultAgents;
  const sub = [
    context,
    workspaceDir ? `Proyecto: ${workspaceDir}` : "",
    images.length ? `Imágenes: ${images.length}` : "",
    parsedTimeoutMs ? `Timeout: ${Math.round(parsedTimeoutMs / 1000)}s` : "",
    `Magistrados: ${chosen.join(", ")}`,
  ]
    .filter(Boolean)
    .join(" · ");
  console.log(`\n${banner(`⚖️  TRIBUNAL · ${topic}`, sub)}\n`);

  const progress = createRoundProgress(config.agents);
  try {
    const session = await withAbortOnSigint((signal) =>
      engine.openCase({
        topic,
        context,
        workspaceDir,
        images,
        agents,
        debateRounds: /^\d+$/.test(debateRounds) ? Number(debateRounds) : NaN,
        ...(parsedTimeoutMs !== undefined ? { timeoutMs: parsedTimeoutMs } : {}),
        signal,
        onAgentStart: (ev) => progress.start(ev),
        onAgentDone: (ev) => progress.done(ev),
        onRound: (round) => {
          progress.stop();
          printRound(round, config.agents);
        },
      })
    );
    printSavedSession(session, store);
    return session;
  } finally {
    progress.stop();
  }
}

async function handleChallenge({ args, config, engine, store, isInteractive }) {
  let [sessionId, objection, agentsCsv] = args;
  let targetAgents = parseAgentNames(agentsCsv);
  let images = [];

  if (!sessionId && isInteractive) {
    sessionId = await pickSession(engine, "Elige el caso a cuestionar");
    if (!sessionId) return;
  }

  if (sessionId && !objection && isInteractive) {
    objection = await askLine("Tu objeción o pregunta como juez (Enter para volver):");
    if (!objection) return;
    const imagesInput = await askLine("Imágenes adjuntas (rutas separadas por coma, Enter para omitir):");
    if (imagesInput === undefined) return;
    images = parseImagePaths(imagesInput);
    const session = await engine.inspectCase(sessionId);
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
  const progress = createRoundProgress(config.agents);
  try {
    const session = await withAbortOnSigint((signal) =>
      engine.challengeCase({
        sessionId,
        objection,
        images,
        targetAgents,
        signal,
        onAgentStart: (ev) => progress.start(ev),
        onAgentDone: (ev) => progress.done(ev),
        onRound: (round) => {
          progress.stop();
          printRound(round, config.agents);
        },
      })
    );
    printSavedSession(session, store);
  } finally {
    progress.stop();
  }
}

async function handleDebate({ args, config, engine, store, isInteractive }) {
  let [sessionId, agentsCsv] = args;
  let targetAgents = parseAgentNames(agentsCsv);

  if (!sessionId && isInteractive) {
    sessionId = await pickSession(engine, "Elige el caso a redebatir");
    if (!sessionId) return;
  }
  if (!sessionId) {
    throw new Error("Uso: pnpm start debatir <sessionId> [agente1,agente2]");
  }

  if (!agentsCsv && isInteractive) {
    const session = await engine.inspectCase(sessionId);
    const sessionAgents = Object.fromEntries(
      session.agents.map((name) => [name, config.agents[name] || { type: "agente" }])
    );
    targetAgents = await select(
      "¿Qué agentes participan en la réplica?",
      agentOptions(sessionAgents, session.agents),
      { selected: session.agents, multiple: true }
    );
    if (!targetAgents) return;
  }

  console.log(`\n${divider(`Réplica en ${sessionId}`, TRIBUNAL_GOLD)}\n`);
  const progress = createRoundProgress(config.agents);
  try {
    const session = await withAbortOnSigint((signal) =>
      engine.debateCase({
        sessionId,
        targetAgents,
        signal,
        onAgentStart: (ev) => progress.start(ev),
        onAgentDone: (ev) => progress.done(ev),
        onRound: (round) => {
          progress.stop();
          printRound(round, config.agents);
        },
      })
    );
    printSavedSession(session, store);
  } finally {
    progress.stop();
  }
}

async function handleView({ args, config, engine, isInteractive }) {
  let [sessionId] = args;
  if (!sessionId && isInteractive) {
    sessionId = await pickSession(engine, "Elige un caso guardado");
    if (!sessionId) return null;
  }
  if (!sessionId) {
    throw new Error("Uso: pnpm start ver <sessionId>");
  }

  const session = await engine.inspectCase(sessionId);
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

async function handleList({ engine }) {
  const cases = await engine.listCases();
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
  const cases = await engine.listCases();
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

function parseImagePaths(raw = "") {
  return raw
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function printSavedSession(session, store) {
  console.log(`\n${divider("Sesión guardada", 92)}`);
  console.log(`  ${colorize("ID:", "1;90")}   ${colorize(session.id, "1;96")} ${colorize(`(${session.status})`, 90)}`);
  console.log(`  ${colorize("Acta:", "1;90")} ${store.getMarkdownPath(session.id)}\n`);
}

function printRound(round, agents) {
  const roundColor = ROUND_COLORS[round.type] || 96;
  const contentWidth = Math.min(82, Math.max(44, (process.stdout.columns || 90) - 8));

  console.log(`\n${divider(`Ronda ${round.number} · ${round.type.toUpperCase()}`, roundColor)}`);
  if (round.userObjection) {
    console.log(`\n  ${colorize("Objeción del juez:", "1;95")}`);
    for (const line of renderRichLines(round.userObjection, { width: contentWidth })) {
      console.log(`    ${line}`);
    }
  }
  for (const entry of round.entries) {
    const color = agentColor(agents, entry.agent);
    const type = agents?.[entry.agent]?.type;
    const badge = type ? `${colorize(`[${type}]`, color)} ` : "";
    const name = colorize(entry.agent, `1;${color}`);
    const role = entry.role ? colorize(` · ${entry.role}`, 90) : "";
    const duration = entry.durationMs ? colorize(` · ${(entry.durationMs / 1000).toFixed(1)}s`, 90) : "";
    const bar = colorize("│", color);

    console.log(`\n  ${colorize("╭─", color)} ${badge}${name}${role}${duration}`);
    if (entry.error) {
      console.log(`  ${colorize("│", 91)} ${colorize("Error:", "1;91")}`);
      for (const line of renderRichLines(entry.error, { width: contentWidth })) {
        console.log(`  ${colorize("│", 91)}   ${line}`);
      }
    } else {
      const printSection = (title, titleStyle, text) => {
        console.log(`  ${bar} ${colorize(title, titleStyle)}`);
        for (const line of renderRichLines(text, { width: contentWidth })) {
          console.log(`  ${bar}   ${line}`);
        }
      };

      printSection("RESUMEN", `1;${TRIBUNAL_GOLD}`, entry.summary ?? entry.resumen ?? "");
      console.log(`  ${bar}`);
      printSection("DISIDENCIAS", "1;93", entry.dissents ?? entry.disidencias ?? "");
      console.log(`  ${bar}`);
      printSection("ARGUMENTOS", "1;96", entry.reasoning ?? entry.razonamiento ?? "");
    }
    console.log(`  ${colorize("╰" + "─".repeat(Math.min(48, contentWidth)), color)}`);
  }
}

function printHelp() {
  console.log(`
${banner("⚖️  Agent Tribunal", "CLI modular multi-agente")}

${colorize("Modo sencillo (menú interactivo):", "1;96")}
  pnpm start

${colorize("Comandos directos:", "1;93")}
  pnpm start abrir         ${colorize("(asistente interactivo)", 90)}
  pnpm start abrir "<tema>" "[contexto]" "[agente1,agente2]" [rondas] [rutaCodigo] [timeoutSeg]
  pnpm start listar        ${colorize("(sesiones guardadas)", 90)}
  pnpm start ver [id]      ${colorize("(inspecciona sin gastar tokens)", 90)}
  pnpm start cuestionar [id] "<objeción>" "[agentes]"
  pnpm start debatir [id]  ${colorize("(lanza una ronda de réplica entre agentes)", 90)}
  pnpm start agentes       ${colorize("(lista perfiles con sus colores, modelos y timeout)", 90)}
  pnpm start configurar    ${colorize("(cambiar modelo, clonar, predeterminados, eliminar o timeout)", 90)}
`);
}

main().catch((error) => {
  console.error(`\n${colorize("Error:", "1;91")} ${error.message}`);
  process.exit(1);
});
