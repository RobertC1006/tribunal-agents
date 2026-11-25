import { BaseAgent, parseAgentOutput } from "./baseAgent.js";

/**
 * Módulo simulado (cero costo, sin red) para probar el tribunal,
 * las rutas de Express y el flujo de sesiones dormidas localmente.
 */
export class MockAgent extends BaseAgent {
  async ask({ prompt, roundType, topic }) {
    const stance = this.config.stance || "pragmatico";

    const templates = {
      cauteloso: {
        apertura: `RESUMEN: Para "${topic}", priorizaría empezar pequeño con límites claros y validaciones antes de escalar.
DISIDENCIAS: Aún es ronda inicial (sin posturas previas que refutar).
RAZONAMIENTO: Veo riesgo en sobre-diseñar sin validar primero el problema real. Recomiendo arquitectura modular sencilla, pruebas base y persistencia clara en disco.`,
        debate: `RESUMEN: Mantengo el enfoque modular y advierto contra atajos que luego dificulten auditar el sistema.
DISIDENCIAS: Difiero de la postura puramente rápida si sacrifica contratos claros entre módulos.
RAZONAMIENTO: Al revisar las otras posturas sobre "${topic}", coincido en evitar complejidad innecesaria, pero no conviene saltar la separación entre motor y conectores.`,
        cuestionamiento: `RESUMEN: Ajusto mi postura incorporando la objeción del usuario y propongo un paso intermedio verificable.
DISIDENCIAS: Sigo defendiendo mantener pruebas mínimas incluso bajo restricciones de tiempo.
RAZONAMIENTO: Tomando en cuenta tu cuestionamiento (${prompt.slice(-120).replace(/\s+/g, " ")}), reduciría el alcance inicial a un solo flujo end-to-end bien probado.`,
      },
      pragmatico: {
        apertura: `RESUMEN: En "${topic}", elegiría el camino más directo que entregue algo usable hoy mismo.
DISIDENCIAS: Aún es ronda inicial (sin posturas previas que refutar).
RAZONAMIENTO: Prefiero validar con un prototipo funcional usando herramientas familiares como Node.js y Express antes de introducir abstracciones pesadas.`,
        debate: `RESUMEN: Coincido en modularizar, pero con el mínimo número de archivos posibles para no frenar el avance.
DISIDENCIAS: Difiero de añadir capas teóricas antes de tener al menos dos agentes reales funcionando.
RAZONAMIENTO: Después de leer a los demás en "${topic}", creo que un JSON por sesión y módulos por agente bastan para arrancar y luego conectar MCP encima.`,
        cuestionamiento: `RESUMEN: Recorto aún más la solución para responder directo a la restricción planteada por el usuario.
DISIDENCIAS: Difiero de postergar la prueba real; es mejor probar con un caso pequeño hoy.
RAZONAMIENTO: Frente a tu observación, la acción concreta es implementar primero el flujo de apertura y cuestionamiento y dejar optimizaciones para una segunda iteración.`,
      },
      critico: {
        apertura: `RESUMEN: Antes de decidir sobre "${topic}", cuestionaría si el costo de contexto y mantenimiento realmente se justifica.
DISIDENCIAS: Aún es ronda inicial (sin posturas previas que refutar).
RAZONAMIENTO: Mi foco es detectar puntos ciegos: consumo de tokens, dependencia de servicios pagos y qué ocurre cuando una IA falla o no responde.`,
        debate: `RESUMEN: Insisto en manejar fallos por agente y limitar el tamaño del contexto que viaja entre rondas.
DISIDENCIAS: Difiero de asumir que todos los agentes responderán rápido o seguirán exactamente el formato pedido.
RAZONAMIENTO: Revisando el debate de "${topic}", falta contemplar timeouts, respuestas parciales y compatibilidad con modelos locales más pequeños.`,
        cuestionamiento: `RESUMEN: Valido la objeción del usuario: expone un supuesto que el tribunal había dado por hecho.
DISIDENCIAS: Difiero de cerrar el veredicto sin definir un criterio medible de éxito.
RAZONAMIENTO: Tu cuestionamiento obliga a revisar los supuestos base. Sugiero registrar explícitamente el límite que señalas dentro del acta de la sesión.`,
      },
    };

    const selected = templates[stance] || templates.pragmatico;
    const raw = selected[roundType] || selected.apertura;

    return parseAgentOutput(raw);
  }
}
