# Capa MCP (Siguiente paso)

Esta carpeta alojará el servidor MCP (`server.js`) una vez que el núcleo modular
(`src/engine/tribunalEngine.js`) esté probado a gusto.

Gracias a la arquitectura modular, el servidor MCP no tendrá lógica de debate propia;
únicamente expondrá las 4 operaciones del motor como herramientas MCP:

1. `abrir_caso(topic, context, agents)` -> llama a `engine.abrirCaso(...)`
2. `cuestionar_caso(sessionId, objection, targetAgents)` -> llama a `engine.cuestionarCaso(...)`
3. `inspeccionar_caso(sessionId)` -> llama a `engine.inspeccionarCaso(...)`
4. `listar_casos()` -> llama a `engine.listarCasos()`

Cuando quieras activar esta capa, solo instalarás:

```bash
pnpm add @modelcontextprotocol/sdk zod
```
