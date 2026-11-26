import { randomBytes } from "node:crypto";
import { createAgent } from "../agents/registry.js";
import { buildPrompt } from "../sessions/contextBuilder.js";

/**
 * Motor central del Tribunal.
 * Es completamente independiente de la interfaz (puede llamarse desde CLI,
 * desde una futura UI o desde un servidor MCP sin cambiar una línea aquí).
 */
export class TribunalEngine {
  constructor({ config, store }) {
    this.config = config;
    this.store = store;
  }

  /**
   * Crea una nueva sesión hija con su cápsula de contexto, ejecuta:
   *  - Ronda 1: apertura ciega en paralelo (Promise.all)
   *  - Rondas de debate opcionales que usan los resúmenes previos
   * Al terminar, la sesión queda en estado "dormida" en disco (0 procesos activos).
   */
  async abrirCaso({
    topic, context = "", agents, includeDebateRound = true,
    debateRounds = includeDebateRound ? 1 : 0, onRound,
  }) {
    if (!Number.isSafeInteger(debateRounds) || debateRounds < 0) {
      const error = new Error("El número de rondas de debate debe ser un entero no negativo.");
      error.statusCode = 400;
      throw error;
    }

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
      status: "activa",
      agents: selectedAgents,
      createdAt: now,
      updatedAt: now,
      rounds: [],
    };

    await this.runRound(session, {
      roundType: "apertura",
      targetAgents: selectedAgents,
      onRound,
    });

    for (let i = 0; i < debateRounds; i += 1) {
      await this.runRound(session, {
        roundType: "debate",
        targetAgents: selectedAgents,
        onRound,
      });
    }

    session.status = "dormida";
    await this.store.save(session);
    return session;
  }

  /**
   * Despierta temporalmente una sesión dormida, inyecta la objeción del usuario,
   * recoge las nuevas respuestas y vuelve a guardarla como "dormida".
   */
  async cuestionarCaso({ sessionId, objection, targetAgents, onRound }) {
    const session = await this.store.load(sessionId);
    const agentsToAsk =
      Array.isArray(targetAgents) && targetAgents.length > 0
        ? targetAgents
        : session.agents;

    session.status = "activa";

    await this.runRound(session, {
      roundType: "cuestionamiento",
      targetAgents: agentsToAsk,
      userObjection: objection,
      onRound,
    });

    session.status = "dormida";
    await this.store.save(session);
    return session;
  }

  /**
   * Inspecciona una sesión dormida sin llamar a ninguna IA (costo 0 tokens).
   */
  async inspeccionarCaso(sessionId) {
    return this.store.load(sessionId);
  }

  async listarCasos() {
    return this.store.list();
  }

  async runRound(session, { roundType, targetAgents, userObjection = "", onRound }) {
    const agents = targetAgents.map((name) =>
      createAgent(name, this.config.agents[name])
    );

    const entries = await Promise.all(
      agents.map(async (agent) => {
        const prompt = buildPrompt({
          session,
          agent,
          roundType,
          objection: userObjection,
        });

        try {
          const result = await agent.ask({
            prompt,
            roundType,
            topic: session.topic,
          });
          return {
            agent: agent.name,
            role: agent.role,
            resumen: result.resumen,
            disidencias: result.disidencias,
            razonamiento: result.razonamiento,
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          return {
            agent: agent.name,
            role: agent.role,
            error: error.message,
            timestamp: new Date().toISOString(),
          };
        }
      })
    );

    const round = {
      number: session.rounds.length + 1,
      type: roundType,
      userObjection: userObjection || undefined,
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
