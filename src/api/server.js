#!/usr/bin/env node
import { loadConfig } from "../config/loadConfig.js";
import { TribunalEngine } from "../engine/tribunalEngine.js";
import { SessionStore } from "../sessions/sessionStore.js";
import { createApp } from "./createApp.js";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

async function startServer() {
  const config = await loadConfig();
  const store = new SessionStore(config.sessionsDir);
  const engine = new TribunalEngine({ config, store });
  const app = createApp({ config, engine });

  app.listen(PORT, HOST, () => {
    console.log(`⚖️  Agent Tribunal (visor web + API) en http://${HOST}:${PORT}`);
    console.log(`   - UI   http://${HOST}:${PORT}/`);
    console.log(`   - GET  /health`);
    console.log(`   - GET  /api/agentes`);
    console.log(`   - GET  /api/casos`);
    console.log(`   - POST /api/casos`);
    console.log(`   - GET  /api/casos/:sessionId`);
    console.log(`   - POST /api/casos/:sessionId/cuestionar`);
  });
}

startServer().catch((error) => {
  console.error(`Error al iniciar el servidor Express: ${error.message}`);
  process.exit(1);
});
