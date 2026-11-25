# Tribunal de Agentes

Proyecto Open Source en **Node.js (ESM) + Express** con arquitectura modular para conectar múltiples agentes de IA (`claude`, `codex`, `agy` y modelos locales como **Ollama**), hacer que debatan y difieran entre sí, y permitir que el usuario audite y cuestione sus resultados.

## Arquitectura modular

```text
src/
├── agents/                     # Un módulo dedicado por cada agente específico
│   ├── baseAgent.js            # Clase base + helpers (parseAgentOutput, runProcess)
│   ├── claudeAgent.js          # Flags y ejecución propios de Claude Code CLI
│   ├── codexAgent.js           # Flags y ejecución propios de Codex CLI
│   ├── agyAgent.js             # Flags y ejecución propios de AGY CLI
│   ├── ollamaAgent.js          # Conector HTTP local para Ollama (localhost:11434)
│   ├── mockAgent.js            # Agente simulado para pruebas sin gastar tokens
│   └── registry.js             # Registro central que instancia cada módulo
├── sessions/                   # Persistencia y control de contexto
│   ├── sessionStore.js         # Guarda sesiones "dormidas" en JSON + acta Markdown
│   └── contextBuilder.js       # Construye prompts compactos usando solo resúmenes previos
├── engine/
│   └── tribunalEngine.js       # Orquestador independiente (CLI, Express y MCP usan lo mismo)
├── api/                        # Capa HTTP con Express
│   ├── createApp.js            # Configura Express y manejo de errores
│   ├── server.js               # Arranca el servidor local en http://localhost:3000
│   └── routes/
│       ├── cases.routes.js     # GET/POST /api/casos y POST /api/casos/:id/cuestionar
│       └── agents.routes.js    # GET /api/agentes
├── config/
│   └── loadConfig.js           # Carga tribunal.config.json
├── mcp/
│   └── README.md               # Punto de extensión para exponer el motor vía MCP
└── index.js                    # CLI directa
```

## Instalación y uso

1. Instala Express para habilitar el servidor HTTP:
   ```bash
   pnpm add express
   ```

2. Corre las pruebas:
   ```bash
   node --test
   ```

3. Arranca el servidor Express:
   ```bash
   pnpm run server
   ```

4. Endpoints listos en `http://localhost:3000`:
   - `GET /health`
   - `GET /api/agentes`
   - `GET /api/casos`
   - `POST /api/casos` — body: `{ "topic": "¿SQLite o JSON?", "context": "App local" }`
   - `GET /api/casos/:sessionId`
   - `POST /api/casos/:sessionId/cuestionar` — body: `{ "objection": "¿Y si hay 500 sesiones?" }`

5. O úsalo directo por CLI:
   ```bash
   node src/index.js abrir "¿Usar SQLite o JSON para sesiones?" "Proyecto local ligero"
   node src/index.js agentes
   node src/index.js configurar
   node src/index.js abrir "¿SQLite o JSON?" "Proyecto local ligero" "claude1,claude2" 2
   node src/index.js listar
   node src/index.js ver <sessionId>
   node src/index.js cuestionar <sessionId> "¿Y si quiero buscar texto en 500 sesiones?"
   ```

Ejecuta `node src/index.js abrir` sin argumentos para elegir los participantes y sus
modelos desde la terminal. Usa las flechas para moverte, Espacio para marcar y Enter
para confirmar. Esc vuelve al menú anterior o cancela la apertura.

El menú `configurar` usa el mismo selector para cambiar modelos y elegir los
participantes predeterminados. Puedes crear un perfil a partir de otro y elegir
«Escribir otro ID» si el modelo no aparece. Los cambios se guardan en `tribunal.config.json`.
`claude1` usa Fable 5.2 y `claude2` usa Opus 5.5 si están disponibles en tu cuenta de Claude Code.
El último argumento indica cuántas rondas de debate habrá después de la apertura.
El valor por defecto es `1`. Con `0` solo se ejecuta la apertura.
