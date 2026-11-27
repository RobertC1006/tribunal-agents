#!/usr/bin/env node
import { loadRuntime } from "../config/runtime.js";
import { createApp } from "./createApp.js";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

async function startServer() {
  // Se lee una vez al arrancar para fallar pronto si la configuración está rota;
  // después cada petición vuelve a leerla, así un perfil nuevo funciona sin reiniciar.
  await loadRuntime();
  // Escuchando en todas las interfaces no se sabe con qué nombre llegarán: se desactiva el filtro de Host.
  const isWildcard = ["0.0.0.0", "::", "[::]"].includes(HOST);
  const allowedHosts = isWildcard ? null : ["localhost", "127.0.0.1", "[::1]", HOST];
  const app = createApp({ loadRuntime, allowedHosts });

  app.listen(PORT, HOST, () => {
    console.log(`⚖️  Tribunal Agents (visor web + API) en http://${HOST}:${PORT}`);
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
