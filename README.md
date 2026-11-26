<p align="center">
  <img src="assets/banner.svg" alt="Agent Tribunal" width="640" />
</p>

# Agent Tribunal

Proyecto Open Source en **Node.js (ESM) + Express** con arquitectura modular para convocar múltiples agentes de IA (`claude`, `codex`, `agy`, `opencode` y modelos locales como **Ollama**), hacer que debatan en apertura ciega y réplica, y permitir que el usuario audite y cuestione sus resultados desde CLI, API HTTP o **MCP**.

## Instalación rápida

Requisitos: **Node.js 20+** y **pnpm**. Los CLIs de IA (`claude`, `codex`, `agy`, `opencode` u `ollama`) son opcionales: el repositorio incluye una configuración predeterminada con simuladores (`mock`) para probarlo sin gastar tokens.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm start
```

Al ejecutar `pnpm start` sin argumentos se abre el menú interactivo para crear casos, ver/cuestionar/redebatir sesiones guardadas o configurar tus agentes y modelos.

## Configuración personal vs. predeterminada

- `tribunal.config.default.json` es la plantilla neutra versionada en el repositorio.
- `tribunal.config.json` es tu configuración personal (ignorada por Git). Cuando ejecutes `pnpm start configurar` por primera vez, se creará automáticamente a partir del archivo predeterminado sin ensuciar `git status`.
- También puedes apuntar a otro archivo mediante la variable de entorno `TRIBUNAL_CONFIG`.

## Comandos CLI

```bash
pnpm start                                   # Menú interactivo
pnpm start abrir                             # Asistente interactivo para abrir un caso
pnpm start abrir "<tema>" "[contexto]" "[agente1,agente2]" [rondas] [rutaCodigo] [timeoutSeg]
pnpm start listar                            # Lista sesiones guardadas (0 tokens)
pnpm start ver [sessionId]                   # Inspecciona un acta guardada (0 tokens)
pnpm start cuestionar [sessionId] "<objeción>" "[agentes]"
pnpm start debatir [sessionId] "[agentes]"   # Lanza una ronda adicional de réplica
pnpm start agentes                           # Muestra perfiles, modelos y timeouts
pnpm start configurar                        # Añadir perfil (claude, codex, agy, opencode, ollama), cambiar modelo, clonar, predeterminados, eliminar o timeout
```

> **Consejo práctico:** empieza con **1 ronda de debate** (`debateRounds: 1`, valor por defecto = 2 rondas en total: apertura ciega + debate). Al terminar, la CLI te preguntará si deseas escribir un cuestionamiento, redebatir la última ronda o dejar la sesión dormida (0 procesos en memoria).

## Integración MCP (Claude Code, Codex y Antigravity)

Consulta [src/mcp/README.md](src/mcp/README.md) para registrar `src/mcp/server.js` y convocar al Tribunal directamente desde tu asistente habitual.

## API HTTP local (Express)

```bash
pnpm run server
```

Escucha por defecto en `http://127.0.0.1:3000` (configurable con `HOST` y `PORT`):
- `GET /health`
- `GET /api/agentes`
- `GET /api/casos`
- `POST /api/casos` — `{ "topic": "¿SQLite o JSON?", "context": "App local", "debateRounds": 1 }`
- `GET /api/casos/:sessionId`
- `POST /api/casos/:sessionId/cuestionar` — `{ "objection": "¿Y si hay 500 sesiones?" }`
- `POST /api/casos/:sessionId/debatir` — `{ "targetAgents": ["claude", "codex"] }`
- `POST /api/casos/:sessionId/destacados` — `{ "round": 1, "agent": "claude", "text": "fragmento", "note": "opcional" }`
- `DELETE /api/casos/:sessionId/destacados/:highlightId`

**Destacar fragmentos:** en el visor web selecciona texto de la respuesta de un agente y pulsa «📌 Destacar» (también `pnpm start destacar` o la herramienta MCP `destacar_fragmento`). El fragmento queda fijado en el caso y se envía a todos los magistrados en cada ronda siguiente hasta que lo quites.

## Arquitectura

```text
src/
├── agents/                     # Conectores: claude, codex, agy, opencode, ollama y mock
├── sessions/                   # Persistencia atómica (JSON + acta MD) y compactación de contexto
├── engine/tribunalEngine.js    # Motor central compartido por CLI, Express y MCP
├── api/                        # Servidor Express local
├── config/                     # Resolución default/local, catálogos y editor interactivo
├── mcp/server.js               # Servidor MCP stdio sin dependencias extra
├── terminal.js                 # Selectores, spinner en vivo y formato Markdown con word-wrap
└── index.js                    # Entrada CLI
```

## Licencia

[MIT](LICENSE)
