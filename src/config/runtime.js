import { TribunalEngine } from "../engine/tribunalEngine.js";
import { SessionStore } from "../sessions/sessionStore.js";
import { loadConfig } from "./loadConfig.js";

/**
 * Lee la configuración vigente y arma un motor nuevo con ella.
 * El MCP y la web lo llaman en cada petición: un perfil recién añadido funciona sin
 * reiniciar, y una ronda en curso conserva su propio almacén aunque cambie sessionsDir.
 * Crear estos objetos es barato; los candados de archivo coordinan las escrituras.
 */
export async function loadRuntime() {
  const config = await loadConfig();
  const store = new SessionStore(config.sessionsDir);
  return { config, store, engine: new TribunalEngine({ config, store }) };
}
