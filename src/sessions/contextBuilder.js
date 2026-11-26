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
export function buildPrompt({ session, agent, roundType, objection = "" }) {
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
  ].join("\n");

  if (roundType === "apertura") {
    return [
      header,
      "",
      "RONDA 1 (APERTURA CIEGA): Expón tu postura inicial de forma independiente.",
      FORMAT_INSTRUCTIONS,
    ].join("\n");
  }

  const compactHistory = formatCompactHistory(session.rounds);

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

function formatCompactHistory(rounds) {
  if (!rounds.length) return "(Sin intervenciones previas)";

  return rounds
    .map((round, index) => {
      const isLatest = index === rounds.length - 1;
      const lines = [`--- Ronda ${round.number} (${round.type}) ---`];
      if (round.userObjection) {
        lines.push(`Objeción del usuario: ${round.userObjection}`);
      }
      for (const entry of round.entries) {
        if (entry.error) {
          lines.push(`- ${entry.agent}: [ERROR] ${entry.error}`);
        } else {
          const summary = entry.summary ?? entry.resumen ?? "";
          const dissents = entry.dissents ?? entry.disidencias ?? "";
          const reasoning = entry.reasoning ?? entry.razonamiento ?? "";
          lines.push(`- ${entry.agent} | Resumen: ${summary}`);
          lines.push(`  Disidencias: ${dissents}`);
          if (isLatest && reasoning) {
            const excerpt = String(reasoning).replace(/\s+/g, " ").trim().slice(0, 1200);
            lines.push(`  Argumentos (extracto): ${excerpt}`);
          }
        }
      }
      return lines.join("\n");
    })
    .join("\n\n");
}
