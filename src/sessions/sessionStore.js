import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatHighlight } from "./contextBuilder.js";

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const ATTACHMENT_NAME_PATTERN = /^[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/i;
const MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

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

  getAttachmentsDir() {
    return path.join(this.sessionsDir, "attachments");
  }

  getAttachmentPath(fileName) {
    if (typeof fileName !== "string" || !ATTACHMENT_NAME_PATTERN.test(fileName)) {
      const error = new Error(`Nombre de adjunto inválido: "${fileName}".`);
      error.statusCode = 400;
      throw error;
    }
    return path.join(this.getAttachmentsDir(), fileName);
  }

  async saveAttachment({ dataUrl }) {
    const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) {
      const error = new Error("Formato de imagen inválido. Usa PNG, JPEG, WEBP o GIF en data URL base64.");
      error.statusCode = 400;
      throw error;
    }
    const ext = MIME_TO_EXT[match[1]];
    const fileName = `img-${randomUUID().slice(0, 12)}.${ext}`;
    const attachmentsDir = this.getAttachmentsDir();
    await mkdir(attachmentsDir, { recursive: true });
    const targetPath = path.join(attachmentsDir, fileName);
    await writeFile(targetPath, Buffer.from(match[2], "base64"));
    return targetPath;
  }

  async save(session) {
    await this.ensureDir();
    session.updatedAt = new Date().toISOString();

    await writeAtomic(
      this.getJsonPath(session.id),
      JSON.stringify(session, null, 2)
    );

    await writeAtomic(
      this.getMarkdownPath(session.id),
      renderMarkdownTranscript(session)
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
      try {
        const raw = await readFile(path.join(this.sessionsDir, file), "utf-8");
        const session = JSON.parse(raw);
        if (!session?.id || !Array.isArray(session.rounds)) continue;
        summaries.push({
          id: session.id,
          topic: session.topic,
          status: session.status,
          agents: session.agents,
          roundsCount: session.rounds.length,
          updatedAt: session.updatedAt,
        });
      } catch {
        // Ignora archivos dañados o a medio escribir para no romper el listado completo.
      }
    }
    return summaries;
  }
}

async function writeAtomic(targetPath, content) {
  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, content, { encoding: "utf-8", flag: "wx" });
    await rename(tempPath, targetPath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

export function renderMarkdownTranscript(session) {
  const lines = [
    `# Acta del Tribunal: ${session.topic}`,
    "",
    `- **ID de sesión:** \`${session.id}\``,
    `- **Estado:** \`${session.status}\``,
    `- **Agentes:** ${session.agents.join(", ")}`,
    ...(session.workspaceDir ? [`- **Proyecto:** \`${session.workspaceDir}\``] : []),
    ...(session.images?.length ? [`- **Imágenes:** ${session.images.map((p) => `\`${p}\``).join(", ")}`] : []),
    `- **Creada:** ${session.createdAt}`,
    `- **Actualizada:** ${session.updatedAt}`,
    "",
    "## Cápsula de contexto",
    "",
    session.context || "_Sin contexto adicional._",
    "",
  ];

  if (session.highlights?.length) {
    lines.push("## Fragmentos destacados", "");
    for (const h of session.highlights) lines.push(`- ${formatHighlight(h)}`);
    lines.push("");
  }

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
        lines.push(`- **Resumen:** ${entry.summary ?? entry.resumen ?? ""}`);
        lines.push(`- **Disidencias:** ${entry.dissents ?? entry.disidencias ?? ""}`);
        lines.push(`- **Razonamiento completo:** ${entry.reasoning ?? entry.razonamiento ?? ""}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
