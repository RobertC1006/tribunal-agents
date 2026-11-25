import express from "express";
import { createAgentsRouter } from "./routes/agents.routes.js";
import { createCasesRouter } from "./routes/cases.routes.js";

/**
 * Construye la app de Express desacoplada del puerto (facilita pruebas y extensión).
 */
export function createApp({ config, engine }) {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "tribunal-agentes" });
  });

  app.use("/api/agentes", createAgentsRouter(config));
  app.use("/api/casos", createCasesRouter(engine));

  // Manejador centralizado de errores
  app.use((error, _req, res, _next) => {
    res.status(500).json({
      ok: false,
      error: error.message || "Error interno en el Tribunal.",
    });
  });

  return app;
}
