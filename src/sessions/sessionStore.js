import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function assertValidSessionId(sessionId) {
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    const error = new Error(
      `ID de sesión inválido: "${sessionId}". Usa solo letras, números, guiones y guiones bajos.`
    );
    error.code = "INVALID_SESSION_ID";
    error.statusCode = 400;
    throw error;
  }
}

/**
 * Maneja la persistencia de sesiones "dormidas" en disco.
 * Cada caso se guarda en:
 *  - <id>.json: estado estructurado que el motor lee al reabrir la sesión.
 *  - <id>.md:   acta legible en Markdown para que el usuario la audite fácil.
 */
export class SessionStore {
  constructor(sessionsDir) {
    this.sessionsDir = sessionsDir;
  }

  async ensureDir() {
    await mkdir(this.sessionsDir, { recursive: true });
  }

  getJsonPath(sessionId) {
    assertValidSessionId(sessionId);
    return path.join(this.sessionsDir, `${sessionId}.json`);
  }

  getMarkdownPath(sessionId) {
    assertValidSessionId(sessionId);
    return path.join(this.sessionsDir, `${sessionId}.md`);
  }

  async save(session) {
    await this.ensureDir();
    session.updatedAt = new Date().toISOString();

    await writeFile(
      this.getJsonPath(session.id),
      JSON.stringify(session, null, 2),
      "utf-8"
    );

    await writeFile(
      this.getMarkdownPath(session.id),
      renderMarkdownTranscript(session),
      "utf-8"
    );

    return session;
  }

  async load(sessionId) {
    const raw = await readFile(this.getJsonPath(sessionId), "utf-8");
    return JSON.parse(raw);
  }

  async list() {
    await this.ensureDir();
    const files = await readdir(this.sessionsDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();

    const summaries = [];
    for (const file of jsonFiles) {
      const raw = await readFile(path.join(this.sessionsDir, file), "utf-8");
      const session = JSON.parse(raw);
      summaries.push({
        id: session.id,
        topic: session.topic,
        status: session.status,
        agents: session.agents,
        roundsCount: session.rounds.length,
        updatedAt: session.updatedAt,
      });
    }
    return summaries;
  }
}

export function renderMarkdownTranscript(session) {
  const lines = [
    `# Acta del Tribunal: ${session.topic}`,
    "",
    `- **ID de sesión:** \`${session.id}\``,
    `- **Estado:** \`${session.status}\``,
    `- **Agentes:** ${session.agents.join(", ")}`,
    `- **Creada:** ${session.createdAt}`,
    `- **Actualizada:** ${session.updatedAt}`,
    "",
    "## Cápsula de contexto",
    "",
    session.context || "_Sin contexto adicional._",
    "",
  ];

  for (const round of session.rounds) {
    lines.push(`## Ronda ${round.number} — ${round.type}`);
    lines.push("");
    if (round.userObjection) {
      lines.push(`> **Cuestionamiento del usuario:** ${round.userObjection}`);
      lines.push("");
    }
    for (const entry of round.entries) {
      const role = entry.role ? ` (${entry.role})` : "";
      lines.push(`### ${entry.agent}${role}`);
      lines.push("");
      if (entry.error) {
        lines.push(`- **Error:** ${entry.error}`);
      } else {
        lines.push(`- **Resumen:** ${entry.resumen}`);
        lines.push(`- **Disidencias:** ${entry.disidencias}`);
        lines.push(`- **Razonamiento completo:** ${entry.razonamiento}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
