import { Router } from "express";

/**
 * Rutas REST para gestionar los casos del Tribunal.
 * Delega toda la lógica al motor (TribunalEngine) para mantener Express limpio.
 */
export function createCasesRouter(engine) {
  const router = Router();

  // Listar todas las sesiones dormidas/guardadas
  router.get("/", async (_req, res, next) => {
    try {
      const cases = await engine.listarCasos();
      res.json({ ok: true, data: cases });
    } catch (error) {
      next(error);
    }
  });

  // Abrir un nuevo caso (Ronda 1 apertura + Ronda 2 debate)
  router.post("/", async (req, res, next) => {
    try {
      const { topic, context = "", agents, includeDebateRound = true } = req.body || {};

      if (!topic || typeof topic !== "string") {
        return res.status(400).json({
          ok: false,
          error: "El campo 'topic' es obligatorio y debe ser texto.",
        });
      }

      const session = await engine.abrirCaso({
        topic,
        context,
        agents,
        includeDebateRound,
      });

      res.status(201).json({ ok: true, data: session });
    } catch (error) {
      next(error);
    }
  });

  // Inspeccionar una sesión dormida sin gastar tokens (0 llamadas a IA)
  router.get("/:sessionId", async (req, res, next) => {
    try {
      const session = await engine.inspeccionarCaso(req.params.sessionId);
      res.json({ ok: true, data: session });
    } catch (error) {
      if (error.code === "ENOENT") {
        return res.status(404).json({
          ok: false,
          error: `Sesión "${req.params.sessionId}" no encontrada.`,
        });
      }
      next(error);
    }
  });

  // Despertar una sesión dormida para cuestionar el veredicto
  router.post("/:sessionId/cuestionar", async (req, res, next) => {
    try {
      const { objection, targetAgents } = req.body || {};

      if (!objection || typeof objection !== "string") {
        return res.status(400).json({
          ok: false,
          error: "El campo 'objection' es obligatorio y debe ser texto.",
        });
      }

      const session = await engine.cuestionarCaso({
        sessionId: req.params.sessionId,
        objection,
        targetAgents,
      });

      res.json({ ok: true, data: session });
    } catch (error) {
      if (error.code === "ENOENT") {
        return res.status(404).json({
          ok: false,
          error: `Sesión "${req.params.sessionId}" no encontrada.`,
        });
      }
      next(error);
    }
  });

  return router;
}
