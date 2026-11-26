import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createAgentsRouter } from "./routes/agents.routes.js";
import { createCasesRouter } from "./routes/cases.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

/**
 * Builds the Express app decoupled from port binding (easy to test and extend).
 */
export function createApp({ config, engine }) {
  const app = express();

  app.use(express.json({ limit: "15mb" }));
  app.use(express.static(PUBLIC_DIR));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "tribunal-agentes" });
  });

  app.use("/api/agentes", createAgentsRouter(config));
  app.use("/api/casos", createCasesRouter(engine));

  // Manejador centralizado de errores
  app.use((error, _req, res, _next) => {
    const status =
      Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : Number.isInteger(error.status) && error.status >= 400 && error.status < 600
          ? error.status
          : 500;
    res.status(status).json({
      ok: false,
      error: error.message || "Error interno en el Tribunal.",
    });
  });

  return app;
}
