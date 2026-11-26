const FORMAT_INSTRUCTIONS = `
Responde usando EXACTAMENTE estas tres secciones para mantener el contexto limpio:
RESUMEN: (máximo 2-3 líneas con tu postura concreta)
DISIDENCIAS: (en qué difieres de otros agentes o qué riesgo ves)
RAZONAMIENTO: (tu explicación detallada para el usuario humano)
`.trim();

/**
 * Construye el prompt para cada tipo de ronda aplicando compactación de contexto:
 * en lugar de arrastrar todo el historial gigante, inyecta la cápsula inicial
 * del problema + los resúmenes y disidencias de las rondas anteriores.
 */
export function buildPrompt({ session, agent, roundType, objection = "", images = [] }) {
  const attachedImages = [...new Set([...(session.images || []), ...(images || [])])];
  const header = [
    `Eres el magistrado "${agent.name}" dentro de un Tribunal de Agentes.`,
    ...(agent.role ? [`Tu rol: ${agent.role}`] : []),
    `Tema del caso: ${session.topic}`,
    `Cápsula de contexto inicial: ${session.context || "Sin contexto adicional."}`,
    ...(session.workspaceDir
      ? [
          `Directorio del proyecto a investigar: ${session.workspaceDir}`,
          "Instrucción de investigación: Puedes leer e inspeccionar los archivos del proyecto en modo solo lectura (sin modificar archivos) para fundamentar tu postura citando rutas o código real.",
        ]
      : []),
    ...(attachedImages.length
      ? [`Imágenes adjuntas para inspeccionar: ${attachedImages.join(", ")}`]
      : []),
  ].join("\n");

  if (roundType === "apertura") {
    return [
      header,
      "",
      "RONDA 1 (APERTURA CIEGA): Expón tu postura inicial de forma independiente.",
      FORMAT_INSTRUCTIONS,
    ].join("\n");
  }

  const compactHistory = [formatCompactHistory(session.rounds), formatHighlights(session.highlights)]
    .filter(Boolean)
    .join("\n\n");

  if (roundType === "debate") {
    return [
      header,
      "",
      "RESUMEN DE RONDAS PREVIAS:",
      compactHistory,
      "",
      "RONDA DE DEBATE: Lee lo que propusieron los demás magistrados. Señala puntos ciegos, indica explícitamente en qué difieres y defiende o ajusta tu postura.",
      FORMAT_INSTRUCTIONS,
    ].join("\n");
  }

  return [
    header,
    "",
    "RESUMEN DE RONDAS PREVIAS:",
    compactHistory,
    "",
    `CUESTIONAMIENTO DEL USUARIO (JUEZ): "${objection}"`,
    "Responde directamente a la objeción del usuario y reconsidera tu postura si tiene razón.",
    FORMAT_INSTRUCTIONS,
  ].join("\n");
}

export function formatHighlight(h) {
  return `[${h.id} · Ronda ${h.round} · ${h.agent}] "${h.text}"${h.note ? ` — Nota del juez: ${h.note}` : ""}`;
}

function formatHighlights(highlights = []) {
  if (!highlights.length) return "";
  return [
    "FRAGMENTOS DESTACADOS POR EL USUARIO (JUEZ): el juez marcó estos puntos como importantes. Abórdalos explícitamente en tu respuesta.",
    ...highlights.map((h) => `- ${formatHighlight(h)}`),
  ].join("\n");
}

// Presupuesto fijo de contexto: el prompt deja de crecer con el número de rondas.
const DETAILED_ROUNDS = 2;
const BRIEF_ROUNDS = 6;
const DETAILED_CHARS = 1200;
const BRIEF_CHARS = 300;

function clip(text, max) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function formatCompactHistory(rounds) {
  if (!rounds.length) return "(Sin intervenciones previas)";

  const kept = rounds.slice(-(DETAILED_ROUNDS + BRIEF_ROUNDS));
  const omitted = rounds.length - kept.length;
  const blocks = kept.map((round, index) => {
    const detailed = index >= kept.length - DETAILED_ROUNDS;
    const isLatest = index === kept.length - 1;
    const max = detailed ? DETAILED_CHARS : BRIEF_CHARS;
    const lines = [`--- Ronda ${round.number} (${round.type}) ---`];
    if (round.userObjection) {
      lines.push(`Objeción del usuario: ${clip(round.userObjection, max)}`);
    }
    for (const entry of round.entries) {
      if (entry.error) {
        lines.push(`- ${entry.agent}: [ERROR] ${clip(entry.error, BRIEF_CHARS)}`);
        continue;
      }
      lines.push(`- ${entry.agent} | Resumen: ${clip(entry.summary ?? entry.resumen, max)}`);
      if (detailed) {
        lines.push(`  Disidencias: ${clip(entry.dissents ?? entry.disidencias, max)}`);
      }
      const reasoning = entry.reasoning ?? entry.razonamiento;
      if (isLatest && reasoning) {
        lines.push(`  Argumentos (extracto): ${clip(reasoning, DETAILED_CHARS)}`);
      }
    }
    return lines.join("\n");
  });

  if (omitted > 0) {
    blocks.unshift(`(${omitted} rondas anteriores omitidas para mantener el contexto acotado)`);
  }
  return blocks.join("\n\n");
}
