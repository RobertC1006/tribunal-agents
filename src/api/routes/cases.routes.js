import { Router } from "express";

/**
 * Rutas REST para gestionar los casos del Tribunal.
 * Delega toda la lógica al motor (TribunalEngine) para mantener Express limpio.
 */
export function createCasesRouter(engine) {
  const router = Router();

  // Servir adjuntos de imagen guardados en sesiones
  router.get("/attachments/:filename", (req, res, next) => {
    try {
      const filePath = engine.store.getAttachmentPath(req.params.filename);
      res.sendFile(filePath, (err) => {
        if (err) {
          if (err.code === "ENOENT") {
            return res.status(404).json({ ok: false, error: "Adjunto no encontrado." });
          }
          next(err);
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // Listar todas las sesiones dormidas/guardadas
  router.get("/", async (_req, res, next) => {
    try {
      const cases = await engine.listCases();
      res.json({ ok: true, data: cases });
    } catch (error) {
      next(error);
    }
  });

  // Abrir un nuevo caso (Ronda 1 apertura + rondas de debate)
  router.post("/", async (req, res, next) => {
    try {
      const {
        topic,
        context = "",
        workspaceDir = "",
        images = [],
        imageUploads = [],
        agents,
        includeDebateRound = true,
        debateRounds,
        timeoutMs,
        timeoutSec,
      } = req.body || {};

      if (!topic || typeof topic !== "string") {
        return res.status(400).json({
          ok: false,
          error: "El campo 'topic' es obligatorio y debe ser texto.",
        });
      }

      if (agents !== undefined && (!Array.isArray(agents) || agents.some((a) => typeof a !== "string" || !a.trim()))) {
        return res.status(400).json({
          ok: false,
          error: "El campo 'agents' debe ser un arreglo de nombres de agente.",
        });
      }

      const savedUploads = Array.isArray(imageUploads)
        ? await Promise.all(imageUploads.map((item) => engine.store.saveAttachment(item)))
        : [];
      const allImages = [...(Array.isArray(images) ? images : []), ...savedUploads];

      const resolvedTimeoutMs =
        timeoutMs !== undefined
          ? timeoutMs
          : timeoutSec !== undefined
            ? Math.round(Number(timeoutSec) * 1000)
            : undefined;

      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });

      const session = await engine.openCase({
        topic,
        context,
        workspaceDir,
        images: allImages,
        agents,
        signal: controller.signal,
        ...(debateRounds !== undefined ? { debateRounds } : { includeDebateRound }),
        ...(resolvedTimeoutMs !== undefined ? { timeoutMs: resolvedTimeoutMs } : {}),
      });

      res.status(201).json({ ok: true, data: session });
    } catch (error) {
      next(error);
    }
  });

  // Inspeccionar una sesión dormida sin gastar tokens (0 llamadas a IA)
  router.get("/:sessionId", async (req, res, next) => {
    try {
      const session = await engine.inspectCase(req.params.sessionId);
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
      const { objection, targetAgents, images = [], imageUploads = [] } = req.body || {};

      if (!objection || typeof objection !== "string") {
        return res.status(400).json({
          ok: false,
          error: "El campo 'objection' es obligatorio y debe ser texto.",
        });
      }

      if (
        targetAgents !== undefined &&
        (!Array.isArray(targetAgents) || targetAgents.some((a) => typeof a !== "string" || !a.trim()))
      ) {
        return res.status(400).json({
          ok: false,
          error: "El campo 'targetAgents' debe ser un arreglo de nombres de agente.",
        });
      }

      const savedUploads = Array.isArray(imageUploads)
        ? await Promise.all(imageUploads.map((item) => engine.store.saveAttachment(item)))
        : [];
      const allImages = [...(Array.isArray(images) ? images : []), ...savedUploads];

      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });

      const session = await engine.challengeCase({
        sessionId: req.params.sessionId,
        objection,
        images: allImages,
        targetAgents,
        signal: controller.signal,
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

  // Ejecutar una ronda adicional de réplica/debate sobre una sesión dormida
  router.post("/:sessionId/debatir", async (req, res, next) => {
    try {
      const { targetAgents, timeoutMs, timeoutSec } = req.body || {};

      if (
        targetAgents !== undefined &&
        (!Array.isArray(targetAgents) || targetAgents.some((a) => typeof a !== "string" || !a.trim()))
      ) {
        return res.status(400).json({
          ok: false,
          error: "El campo 'targetAgents' debe ser un arreglo de nombres de agente.",
        });
      }

      const resolvedTimeoutMs =
        timeoutMs !== undefined
          ? timeoutMs
          : timeoutSec !== undefined
            ? Math.round(Number(timeoutSec) * 1000)
            : undefined;

      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });

      const session = await engine.debateCase({
        sessionId: req.params.sessionId,
        targetAgents,
        signal: controller.signal,
        ...(resolvedTimeoutMs !== undefined ? { timeoutMs: resolvedTimeoutMs } : {}),
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
