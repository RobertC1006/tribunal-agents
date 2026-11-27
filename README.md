<p align="center">
  <img src="assets/banner.svg" alt="Tribunal Agents" width="640" />
</p>

# Tribunal Agents

**Demo local experimental · v0.1.0**

Convoca a varios agentes de IA (Claude, Codex, Antigravity/`agy`, OpenCode y modelos locales con Ollama) para que debatan una decisión técnica, y tú haces de juez: lees sus posturas, las cuestionas y destacas lo importante. Cada agente es un **magistrado**.

Un caso funciona así:

1. **Apertura ciega.** Cada magistrado da su postura sin ver la de los demás.
2. **Debate.** Cada uno lee a los otros y defiende o ajusta su postura (1 ronda por defecto, hasta 5).
3. **Caso dormido.** El acta queda guardada en disco (JSON + Markdown) sin procesos en memoria.
4. **Cuestionar o redebatir.** Cuando quieras, despiertas el caso con una objeción o una ronda más de debate.

## Privacidad, seguridad y costes

- **Carpetas y proveedores.** El tribunal solicita el modo de solo lectura de cada CLI. Los permisos y el aislamiento dependen de ese CLI. Si indicas una carpeta, los agentes con acceso a archivos pueden leer el código y otros datos, incluidos secretos. El contenido que un agente lee, el contexto y los adjuntos pueden llegar al proveedor que procesa su respuesta. Los resúmenes y los fragmentos destacados también se comparten con los participantes de rondas posteriores. Para la demo, usa una carpeta sin credenciales ni datos privados.
- **Actas.** Los casos se guardan en JSON y Markdown sin cifrar. Pueden incluir rutas, objeciones y extractos de código. El visor también guarda en disco las imágenes que subes. Revisa el acta antes de compartirla.
- **Costes.** Cada magistrado recibe una consulta en la apertura y otra en cada ronda en la que participa. Por ejemplo, dos agentes remotos con una ronda de debate hacen cuatro consultas, que pueden consumir cuota o generar cargos según tu plan. Los simuladores funcionan sin conexión y consultar un acta guardada no llama a ningún proveedor.
- **Visor web.** Úsalo en `127.0.0.1`. Con `HOST=0.0.0.0` escucha en todas las interfaces IPv4, desactiva el filtro de `Host` y queda accesible sin autenticación. Quien pueda acceder podría abrir casos, consumir tu cuota y solicitar la inspección de carpetas con los permisos de tu usuario.

Para reportar un problema en privado, consulta [SECURITY.md](SECURITY.md).

## Requisitos

- **Node.js 20 o superior.**
- Los CLIs de los agentes que quieras usar (`claude`, `codex`, `agy`, `opencode`) o un servidor de Ollama, ya instalados y con sesión iniciada. Son opcionales: la configuración inicial trae tres simuladores (`mock`) para probar sin gastar tokens.

## ¿Cómo lo quieres usar?

| Quiero… | Usa | Sección |
|---|---|---|
| Pedirle a Claude Code (o Codex, Antigravity) que convoque al tribunal mientras trabajo | Servidor MCP | [Como MCP en Claude Code](#como-mcp-en-claude-code) |
| Abrir y cuestionar casos desde la terminal | CLI | [Desde la terminal](#desde-la-terminal) |
| Leer las actas y destacar fragmentos en el navegador | Visor web | [Visor web](#visor-web) |
| Modificar el código del tribunal | Repositorio clonado | [Desarrollo](#desarrollo) |

Las tres formas comparten los mismos casos y la misma configuración: puedes abrir un caso por MCP y cuestionarlo después desde la terminal o la web.

> Los comandos `npx` instalan la versión `v0.1.0` directamente desde GitHub. La primera vez tardan un poco más porque descargan el paquete.

## Como MCP en Claude Code

Regístralo una vez para todos tus proyectos:

```bash
claude mcp add --scope user agent-tribunal -- npx -y -p github:RobertC1006/tribunal-agents#v0.1.0 agent-tribunal-mcp
```

Comprueba que aparece con `/mcp` dentro de Claude Code. Después basta con pedirlo en lenguaje natural, por ejemplo:

- *«Abre un caso en el tribunal: ¿SQLite o PostgreSQL para este proyecto? Que lo investiguen en esta carpeta.»*
- *«Cuestiona el último caso: ¿y si hay 500 usuarios a la vez?»*
- *«Lista los agentes del tribunal.»*

Herramientas que expone:

| Herramienta | Qué hace |
|---|---|
| `abrir_caso` | Abre un caso: tema, contexto, carpeta del proyecto, imágenes, magistrados, rondas de debate y tiempo límite. |
| `cuestionar_caso` | Despierta un caso con una objeción tuya. |
| `debatir_caso` | Lanza otra ronda de debate sobre un caso. |
| `destacar_fragmento` / `quitar_destacado` | Fija (o quita) una frase de un magistrado para que todos la aborden en las rondas siguientes. |
| `inspeccionar_caso` / `listar_casos` | Lee actas guardadas sin llamar a ninguna IA. |
| `listar_agentes` | Muestra los perfiles configurados. |

Para Codex y Antigravity, y el detalle de cada herramienta, consulta [src/mcp/README.md](src/mcp/README.md).

## Desde la terminal

```bash
npx -y github:RobertC1006/tribunal-agents#v0.1.0
```

Sin argumentos abre un menú interactivo para crear casos, ver o cuestionar los guardados y configurar tus agentes. También acepta comandos directos (los mismos de la [referencia de la CLI](#referencia-de-la-cli)):

```bash
npx -y github:RobertC1006/tribunal-agents#v0.1.0 configurar   # elige agentes, modelos y tiempos
npx -y github:RobertC1006/tribunal-agents#v0.1.0 abrir        # asistente para abrir un caso
```

Al abrir un caso con el asistente puedes continuar sin carpeta, pegar su ruta o explorar las carpetas con las flechas desde el directorio donde ejecutaste el comando.

Si lo vas a usar a menudo, instálalo una vez y usa el comando `agent-tribunal`:

```bash
npm install -g github:RobertC1006/tribunal-agents#v0.1.0
agent-tribunal
```

## Visor web

```bash
npx -y -p github:RobertC1006/tribunal-agents#v0.1.0 agent-tribunal-ui
```

Abre `http://127.0.0.1:3000`. Ahí puedes leer las actas, abrir y cuestionar casos, adjuntar imágenes y seleccionar texto de un magistrado para pulsar «📌 Destacar». Cambia la dirección con las variables `HOST` y `PORT`.

Consulta los límites de acceso del visor en [Privacidad, seguridad y costes](#privacidad-seguridad-y-costes).

## Configurar los agentes

La forma más fácil es el menú: `agent-tribunal configurar` (o `pnpm start configurar` en el repositorio). Desde ahí añades perfiles, cambias modelos, razonamiento y tiempos, y eliges los magistrados predeterminados.

**Dónde se guarda todo:**

| Cómo lo usas | Configuración y casos |
|---|---|
| Con `npx` o instalado con `npm install -g` | `~/.agent-tribunal/` |
| Desde el repositorio clonado | La carpeta del repositorio (`tribunal.config.json` y `sessions/`, ignorados por Git) |

Puedes cambiarlo con `TRIBUNAL_HOME` (carpeta de datos) o `TRIBUNAL_CONFIG` (ruta exacta del archivo de configuración). Mientras no exista una configuración personal, se usa la plantilla [`tribunal.config.default.json`](tribunal.config.default.json).

**Un perfil se ve así:**

```json
{
  "defaultAgents": ["claude", "codex"],
  "agents": {
    "claude": { "type": "claude", "model": "opus", "reasoningEffort": "high", "timeoutMs": 300000 },
    "codex": { "type": "codex", "reasoningEffort": "medium", "role": "Revisa sobre todo la seguridad." },
    "ollama-local": { "type": "ollama", "baseUrl": "http://localhost:11434", "model": "qwen3:1.7b" }
  }
}
```

| Campo | Para qué sirve |
|---|---|
| `type` | `claude`, `codex`, `agy`, `opencode`, `ollama` o `mock`. |
| `command` | Ejecutable del CLI, si no está en el `PATH` con su nombre normal. |
| `model`, `reasoningEffort` | Modelo y nivel de razonamiento (`low`, `medium`, `high`, `xhigh`) para Claude y Codex. En agy el nivel va en el nombre del modelo (`gemini-4-neon-high`) y en OpenCode como variante (`proveedor/modelo#high`). |
| `timeoutMs` | Tiempo límite del magistrado en cada ronda. |
| `role` | Instrucción extra para ese magistrado (por ejemplo, la postura que debe defender). |
| `extraArgs` | Argumentos adicionales para su CLI. No pueden quitar el modo de solo lectura: si lo intentan, ese magistrado responde con un error. |

Los cambios se aplican en el siguiente caso o ronda, sin reiniciar nada, también en el visor web y el MCP.

> El tribunal le pide a **agy (Antigravity)** que revise el proyecto con sus herramientas de búsqueda y lectura. Si intenta ejecutar un comando que requiere permiso, el modo no interactivo lo bloquea. Si el debate necesita el resultado de un comando, como la salida de las pruebas, puedes ejecutarlo y pegar el resultado en el contexto del caso. [Modo no interactivo de Antigravity](https://antigravity.google/docs/cli/headless/)

## Tiempos y rondas

- El tiempo límite es **por magistrado y por ronda**: todos corren en paralelo, cada uno con su propio reloj, y el reloj vuelve a cero en cada ronda.
- Funciona como un mínimo: se usa el mayor entre el tiempo del caso, el del perfil, 180 s con razonamiento `high`, 300 s con `xhigh` y 300 s cuando hay carpeta de proyecto. Como máximo, una hora.
- Si un magistrado se pasa del tiempo, su respuesta de esa ronda se pierde (los CLIs entregan la respuesta al final). Con encargos largos, sube el tiempo o pide respuestas más acotadas.
- «2 rondas de debate» producen 3 rondas en total: la apertura más los 2 debates.
- Al cuestionar o redebatir solo puedes elegir magistrados que ya participan en el caso.

## Desarrollo

```bash
git clone https://github.com/RobertC1006/tribunal-agents.git
cd tribunal-agents
pnpm install --frozen-lockfile
pnpm test
pnpm start          # CLI
pnpm run server     # visor web
pnpm run mcp        # servidor MCP
```

Para registrar en Claude Code tu copia local en lugar de la de GitHub:

```bash
claude mcp add --scope user agent-tribunal -- node /ruta/a/tribunal-agents/src/mcp/server.js
```

## Referencia de la CLI

En el repositorio usa `pnpm start <comando>`; instalado, `agent-tribunal <comando>`.

```bash
agent-tribunal                                   # Menú interactivo
agent-tribunal abrir                             # Asistente para abrir un caso
agent-tribunal abrir "<tema>" "[contexto]" "[agente1,agente2]" [rondas] [rutaCodigo] [timeoutSeg]
agent-tribunal listar                            # Casos guardados (0 tokens)
agent-tribunal ver [sessionId]                   # Lee un acta (0 tokens)
agent-tribunal cuestionar [sessionId] "<objeción>" "[agentes]"
agent-tribunal debatir [sessionId] "[agentes]"   # Otra ronda de debate
agent-tribunal destacar                          # Fija un fragmento de un magistrado
agent-tribunal agentes                           # Perfiles, modelos y tiempos
agent-tribunal configurar                        # Añadir, cambiar o eliminar perfiles
```

## Referencia de la API HTTP

Disponible cuando corre el visor web:

- `GET /health`
- `GET /api/agentes`
- `GET /api/casos`
- `POST /api/casos` — `{ "topic": "¿SQLite o JSON?", "context": "App local", "debateRounds": 1 }`
- `GET /api/casos/:sessionId`
- `POST /api/casos/:sessionId/cuestionar` — `{ "objection": "¿Y si hay 500 sesiones?" }`
- `POST /api/casos/:sessionId/debatir` — `{ "targetAgents": ["claude", "codex"] }`
- `POST /api/casos/:sessionId/destacados` — `{ "round": 1, "agent": "claude", "text": "fragmento", "note": "opcional" }`
- `DELETE /api/casos/:sessionId/destacados/:highlightId`

## Arquitectura

```text
src/
├── agents/                     # Conectores: claude, codex, agy, opencode, ollama y mock
├── sessions/                   # Actas en disco (JSON + Markdown) y armado de prompts
├── engine/tribunalEngine.js    # Motor central compartido por CLI, web y MCP
├── api/                        # Visor web y API Express
├── config/                     # Configuración, catálogo de modelos y editor interactivo
├── mcp/server.js               # Servidor MCP por stdio, sin dependencias extra
├── terminal.js                 # Menús, spinner y formato de la terminal
└── index.js                    # Entrada de la CLI
```

## Licencia

[MIT](LICENSE)
