import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { createAgent } from "../agents/registry.js";
import { buildPrompt } from "../sessions/contextBuilder.js";

export const MAX_DEBATE_ROUNDS = 5;
export const WORKSPACE_TIMEOUT_MS = 300000;
export const HIGH_EFFORT_TIMEOUT_MS = 180000;
export const XHIGH_EFFORT_TIMEOUT_MS = 300000;
export const MIN_TIMEOUT_MS = 1000;
export const MAX_TIMEOUT_MS = 3600000;

export function resolveAgentTimeoutMs(
  agentConfig = {},
  { sessionTimeoutMs, roundTimeoutMs, hasWorkspace = false } = {},
) {
  const effort = String(agentConfig.reasoningEffort || "").toLowerCase();
  const model = String(agentConfig.model || "").toLowerCase();
  let effortFloor = 0;
  if (effort === "xhigh" || /(?:^|[-_])xhigh$/.test(model)) {
    effortFloor = XHIGH_EFFORT_TIMEOUT_MS;
  } else if (effort === "high" || /(?:^|[-_])high$/.test(model)) {
    effortFloor = HIGH_EFFORT_TIMEOUT_MS;
  }

  const profileTimeout = agentConfig.timeoutMs || 90000;
  const explicitTimeout = roundTimeoutMs || sessionTimeoutMs || 0;
  const workspaceFloor = hasWorkspace ? WORKSPACE_TIMEOUT_MS : 0;

  return Math.max(profileTimeout, explicitTimeout, effortFloor, workspaceFloor);
}

function validateTimeoutMs(timeoutMs) {
  if (timeoutMs === undefined) return undefined;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    const error = new Error(
      `El timeout debe estar entre ${MIN_TIMEOUT_MS / 1000} y ${MAX_TIMEOUT_MS / 1000} segundos.`
    );
    error.statusCode = 400;
    throw error;
  }
  return timeoutMs;
}

async function resolveWorkspaceDir(workspaceDir) {
  if (!workspaceDir) return undefined;
  const resolved = path.resolve(workspaceDir);
  let info;
  try {
    info = await stat(resolved);
  } catch {
    const error = new Error(`El directorio del proyecto no existe: "${resolved}".`);
    error.statusCode = 400;
    throw error;
  }
  if (!info.isDirectory()) {
    const error = new Error(`La ruta del proyecto no es una carpeta: "${resolved}".`);
    error.statusCode = 400;
    throw error;
  }
  return resolved;
}

async function resolveImagePaths(images = []) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const resolved = [];
  for (const rawPath of images) {
    if (typeof rawPath !== "string" || !rawPath.trim()) continue;
    const fullPath = path.resolve(rawPath.trim());
    let info;
    try {
      info = await stat(fullPath);
    } catch {
      const error = new Error(`La imagen adjunta no existe: "${fullPath}".`);
      error.statusCode = 400;
      throw error;
    }
    if (!info.isFile()) {
      const error = new Error(`La ruta de imagen no es un archivo válido: "${fullPath}".`);
      error.statusCode = 400;
      throw error;
    }
    resolved.push(fullPath);
  }
  return resolved;
}

/**
 * Motor central del Tribunal.
 * Es completamente independiente de la interfaz (puede llamarse desde CLI,
 * desde una futura UI o desde un servidor MCP sin cambiar una línea aquí).
 */
export class TribunalEngine {
  constructor({ config, store }) {
    this.config = config;
    this.store = store;
    this.sessionLocks = new Map();
  }

  async withSessionLock(sessionId, fn) {
    const previous = this.sessionLocks.get(sessionId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.sessionLocks.set(sessionId, tail);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.sessionLocks.get(sessionId) === tail) {
        this.sessionLocks.delete(sessionId);
      }
    }
  }

  /**
   * Crea una nueva sesión hija con su cápsula de contexto, ejecuta:
   *  - Ronda 1: apertura ciega en paralelo (Promise.all)
   *  - Rondas de debate opcionales que usan los resúmenes previos
   * Al terminar, la sesión queda en estado "dormida" en disco (0 procesos activos).
   */
  async openCase({
    topic, context = "", workspaceDir = "", images = [], agents, includeDebateRound = true,
    debateRounds = includeDebateRound ? 1 : 0, timeoutMs, signal, onRound, onAgentStart, onAgentDone,
  }) {
    if (!Number.isSafeInteger(debateRounds) || debateRounds < 0 || debateRounds > MAX_DEBATE_ROUNDS) {
      const error = new Error(
        `El número de rondas de debate debe ser un entero no negativo (entre 0 y ${MAX_DEBATE_ROUNDS}).`
      );
      error.statusCode = 400;
      throw error;
    }

    const validatedTimeout = validateTimeoutMs(timeoutMs);
    const resolvedWorkspace = await resolveWorkspaceDir(workspaceDir);
    const resolvedImages = await resolveImagePaths(images);

    const selectedAgents =
      Array.isArray(agents) && agents.length > 0
        ? agents
        : this.config.defaultAgents;

    const id = generateSessionId();
    const now = new Date().toISOString();

    const session = {
      id,
      topic,
      context,
      ...(resolvedWorkspace ? { workspaceDir: resolvedWorkspace } : {}),
      ...(resolvedImages.length ? { images: resolvedImages } : {}),
      ...(validatedTimeout ? { timeoutMs: validatedTimeout } : {}),
      status: "activa",
      agents: selectedAgents,
      createdAt: now,
      updatedAt: now,
      rounds: [],
    };

    try {
      await this.runRound(session, {
        roundType: "apertura",
        targetAgents: selectedAgents,
        images: resolvedImages,
        signal,
        onRound,
        onAgentStart,
        onAgentDone,
      });

      for (let i = 0; i < debateRounds; i += 1) {
        await this.runRound(session, {
          roundType: "debate",
          targetAgents: selectedAgents,
          images: resolvedImages,
          signal,
          onRound,
          onAgentStart,
          onAgentDone,
        });
      }

      session.status = "dormida";
      return session;
    } catch (error) {
      session.status = "interrumpida";
      throw error;
    } finally {
      if (session.rounds.length > 0) {
        await this.store.save(session);
      }
    }
  }

  /**
   * Despierta temporalmente una sesión dormida, inyecta la objeción del usuario,
   * recoge las nuevas respuestas y vuelve a guardarla como "dormida".
   */
  async challengeCase({ sessionId, objection, images = [], targetAgents, timeoutMs, signal, onRound, onAgentStart, onAgentDone }) {
    const validatedTimeout = validateTimeoutMs(timeoutMs);
    const resolvedImages = await resolveImagePaths(images);
    return this.withSessionLock(sessionId, async () => {
      const session = await this.store.load(sessionId);
      const agentsToAsk =
        Array.isArray(targetAgents) && targetAgents.length > 0
          ? targetAgents
          : session.agents;

      session.status = "activa";

      try {
        await this.runRound(session, {
          roundType: "cuestionamiento",
          targetAgents: agentsToAsk,
          userObjection: objection,
          images: resolvedImages,
          timeoutMs: validatedTimeout,
          signal,
          onRound,
          onAgentStart,
          onAgentDone,
        });
        session.status = "dormida";
        return session;
      } catch (error) {
        session.status = "interrumpida";
        throw error;
      } finally {
        await this.store.save(session);
      }
    });
  }

  /**
   * Despierta una sesión dormida para que los magistrados debatan entre sí
   * sobre la última ronda (apertura o cuestionamiento previo).
   */
  async debateCase({ sessionId, targetAgents, timeoutMs, signal, onRound, onAgentStart, onAgentDone }) {
    const validatedTimeout = validateTimeoutMs(timeoutMs);
    return this.withSessionLock(sessionId, async () => {
      const session = await this.store.load(sessionId);
      const agentsToAsk =
        Array.isArray(targetAgents) && targetAgents.length > 0
          ? targetAgents
          : session.agents;

      session.status = "activa";

      try {
        await this.runRound(session, {
          roundType: "debate",
          targetAgents: agentsToAsk,
          timeoutMs: validatedTimeout,
          signal,
          onRound,
          onAgentStart,
          onAgentDone,
        });
        session.status = "dormida";
        return session;
      } catch (error) {
        session.status = "interrumpida";
        throw error;
      } finally {
        await this.store.save(session);
      }
    });
  }

  /**
   * Inspecciona una sesión dormida sin llamar a ninguna IA (costo 0 tokens).
   */
  async inspectCase(sessionId) {
    return this.store.load(sessionId);
  }

  async listCases() {
    return this.store.list();
  }

  async runRound(
    session,
    { roundType, targetAgents, userObjection = "", images = [], timeoutMs: roundTimeoutMs, signal, onRound, onAgentStart, onAgentDone },
  ) {
    const agents = targetAgents.map((name) =>
      createAgent(name, this.config.agents[name])
    );
    const roundNumber = session.rounds.length + 1;
    const roundImages = [...new Set([...(session.images || []), ...(images || [])])];

    const entries = await Promise.all(
      agents.map(async (agent) => {
        const prompt = buildPrompt({
          session,
          agent,
          roundType,
          objection: userObjection,
          images: roundImages,
        });

        const startedAt = Date.now();
        onAgentStart?.({ agent: agent.name, roundNumber, roundType });

        try {
          const timeoutMs = resolveAgentTimeoutMs(agent.config, {
            sessionTimeoutMs: session.timeoutMs,
            roundTimeoutMs,
            hasWorkspace: Boolean(session.workspaceDir),
          });
          const result = await agent.ask({
            prompt,
            roundType,
            topic: session.topic,
            cwd: session.workspaceDir,
            timeoutMs,
            images: roundImages,
            readOnly: Boolean(session.workspaceDir),
            signal,
          });
          const durationMs = Date.now() - startedAt;
          onAgentDone?.({ agent: agent.name, roundNumber, roundType, durationMs, ok: true });
          return {
            agent: agent.name,
            role: agent.role,
            summary: result.summary,
            dissents: result.dissents,
            reasoning: result.reasoning,
            durationMs,
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          const durationMs = Date.now() - startedAt;
          onAgentDone?.({
            agent: agent.name,
            roundNumber,
            roundType,
            durationMs,
            ok: false,
            error: error.message,
          });
          return {
            agent: agent.name,
            role: agent.role,
            error: error.message,
            durationMs,
            timestamp: new Date().toISOString(),
          };
        }
      })
    );

    const round = {
      number: roundNumber,
      type: roundType,
      userObjection: userObjection || undefined,
      images: images.length ? images : undefined,
      entries,
    };
    session.rounds.push(round);

    await this.store.save(session);
    onRound?.(round);
  }
}

function generateSessionId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = randomBytes(3).toString("hex");
  return `caso-${date}-${suffix}`;
}
