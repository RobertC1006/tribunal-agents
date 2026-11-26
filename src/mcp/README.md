# Capa MCP — Integración con Claude Code, Codex y Antigravity (AGY)

El servidor MCP ([server.js](server.js)) corre sobre `stdio` sin dependencias externas adicionales y expone el motor del Tribunal directamente dentro de tus sesiones de **Claude Code**, **Codex** o **Antigravity**:

- `abrir_caso(topic, context?, workspaceDir?, agents?, debateRounds?)`
- `cuestionar_caso(sessionId, objection, targetAgents?)`
- `inspeccionar_caso(sessionId)`
- `listar_casos()`
- `listar_agentes()`

Cuando pasas `workspaceDir` (la ruta del proyecto actual), los agentes CLI se ejecutan en ese directorio en **modo solo lectura** para investigar el código real antes de deliberar.

## Cómo registrarlo

Ruta del servidor en esta máquina:
```text
/home/robertk/Projects/rk-labs/agent-tribunal/src/mcp/server.js
```

### 1. Claude Code (`claude`)
```bash
claude mcp add agent-tribunal -- node /home/robertk/Projects/rk-labs/agent-tribunal/src/mcp/server.js
```

### 2. Codex (`~/.codex/config.toml`)
```toml
[mcp_servers.agent-tribunal]
command = "node"
args = ["/home/robertk/Projects/rk-labs/agent-tribunal/src/mcp/server.js"]
```

### 3. Antigravity (`~/.gemini/antigravity/mcp_config.json`)
```json
{
  "mcpServers": {
    "agent-tribunal": {
      "command": "node",
      "args": ["/home/robertk/Projects/rk-labs/agent-tribunal/src/mcp/server.js"]
    }
  }
}
```

> Si usas `fnm`/`nvm` y el cliente no encuentra `node` en el PATH del sistema, sustituye `"node"` por la ruta absoluta (en esta máquina: `/home/robertk/.local/share/fnm/aliases/default/bin/node`).
