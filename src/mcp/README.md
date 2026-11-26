# Capa MCP — Integración con Claude Code, Codex y Antigravity (AGY)

El servidor MCP ([server.js](server.js)) corre sobre `stdio` sin dependencias externas adicionales y expone el motor del Tribunal directamente dentro de **Claude Code**, **Codex** o **Antigravity**:

- `abrir_caso(topic, context?, workspaceDir?, agents?, debateRounds?, timeoutSec?)`
- `cuestionar_caso(sessionId, objection, targetAgents?)`
- `debatir_caso(sessionId, targetAgents?, timeoutSec?)`
- `destacar_fragmento(sessionId, round, agent, text, note?)` — fija lo que dijo un agente para que todos lo aborden en las próximas rondas
- `quitar_destacado(sessionId, highlightId)`
- `inspeccionar_caso(sessionId)`
- `listar_casos()`
- `listar_agentes()`

Cuando pasas `workspaceDir`, los agentes CLI se ejecutan en esa carpeta con instrucción de solo lectura en el prompt (el alcance efectivo depende de los permisos configurados en cada CLI).

## Cómo registrarlo

Sustituye `<ruta-a-agent-tribunal>` por la ruta absoluta donde clonaste este repositorio.

### 1. Claude Code (`claude`)
```bash
claude mcp add agent-tribunal -- node <ruta-a-agent-tribunal>/src/mcp/server.js
```

### 2. Codex (`~/.codex/config.toml`)
```toml
[mcp_servers.agent-tribunal]
command = "node"
args = ["<ruta-a-agent-tribunal>/src/mcp/server.js"]
```

### 3. Antigravity (`~/.gemini/antigravity/mcp_config.json`)
```json
{
  "mcpServers": {
    "agent-tribunal": {
      "command": "node",
      "args": ["<ruta-a-agent-tribunal>/src/mcp/server.js"]
    }
  }
}
```

> Si usas `fnm` o `nvm` y tu cliente MCP no encuentra `node` en el `PATH` del sistema, reemplaza `"node"` por la ruta absoluta que devuelva `which node`.
> Puedes indicar una configuración alternativa con la variable de entorno `TRIBUNAL_CONFIG`.
