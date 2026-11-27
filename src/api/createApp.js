import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createAgentsRouter } from "./routes/agents.routes.js";
import { createCasesRouter } from "./routes/cases.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Builds the Express app decoupled from port binding (easy to test and extend).
 * `allowedHosts`: Host header names accepted (port ignored); null disables the check.
 * `loadRuntime`: async () => ({ config, engine }) called per request, so config edits
 * apply without a restart. Without it, the fixed `config`/`engine` are used.
 */
export function createApp({
  config,
  engine,
  loadRuntime = async () => ({ config, engine }),
  allowedHosts = LOOPBACK_HOSTS,
}) {
  const app = express();

  // Blocks DNS rebinding: a malicious page whose domain resolves to 127.0.0.1
  // still sends its own name in Host, so it never reaches the API.
  if (allowedHosts) {
    const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
    app.use((req, res, next) => {
      const hostname = String(req.headers.host || "").toLowerCase().replace(/:\d+$/, "");
      if (allowed.has(hostname)) return next();
      res.status(403).json({ ok: false, error: "Host no permitido." });
    });
  }

  app.use(express.json({ limit: "15mb" }));
  app.use(express.static(PUBLIC_DIR));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "tribunal-agentes" });
  });

  app.use("/api", async (req, _res, next) => {
    try {
      req.tribunal = await loadRuntime();
      next();
    } catch (error) {
      next(error);
    }
  });
  app.use("/api/agentes", createAgentsRouter());
  app.use("/api/casos", createCasesRouter());

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
