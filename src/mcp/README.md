# Capa MCP — Integración con Claude Code, Codex y Antigravity (AGY)

El servidor MCP ([server.js](server.js)) corre sobre `stdio` sin dependencias externas adicionales y expone el motor del Tribunal directamente dentro de **Claude Code**, **Codex** o **Antigravity**:

- `abrir_caso(topic, context?, workspaceDir?, images?, agents?, debateRounds?, timeoutSec?)`
- `cuestionar_caso(sessionId, objection, targetAgents?, images?, timeoutSec?)`
- `debatir_caso(sessionId, targetAgents?, timeoutSec?)`
- `destacar_fragmento(sessionId, round, agent, text, note?)` — fija lo que dijo un agente para que todos lo aborden en las próximas rondas
- `quitar_destacado(sessionId, highlightId)`
- `inspeccionar_caso(sessionId)`
- `listar_casos()`
- `listar_agentes()`

Los agentes CLI siempre corren en modo de solo lectura (plan o sandbox de lectura, según el CLI). Si un perfil intenta quitarlo con `extraArgs` (por ejemplo `--permission-mode acceptEdits` o `-s workspace-write`), ese magistrado responde con un error en lugar de ejecutarse. Cuando pasas `workspaceDir`, se ejecutan en esa carpeta.

`targetAgents` solo admite magistrados que participan en el caso. Si el cliente cancela una llamada, los agentes de esa ronda se detienen. La configuración se vuelve a leer en cada llamada.

## Cómo registrarlo

Con `npx` no hace falta clonar nada: se descarga desde GitHub la primera vez. La configuración y los casos quedan en `~/.agent-tribunal/`.

### 1. Claude Code (`claude`)
```bash
claude mcp add --scope user agent-tribunal -- npx -y -p github:RobertC1006/tribunal-agents agent-tribunal-mcp
```

### 2. Codex (`~/.codex/config.toml`)
```toml
[mcp_servers.agent-tribunal]
command = "npx"
args = ["-y", "-p", "github:RobertC1006/tribunal-agents", "agent-tribunal-mcp"]
```

### 3. Antigravity (`~/.gemini/antigravity/mcp_config.json`)
```json
{
  "mcpServers": {
    "agent-tribunal": {
      "command": "npx",
      "args": ["-y", "-p", "github:RobertC1006/tribunal-agents", "agent-tribunal-mcp"]
    }
  }
}
```

### Con una copia local del repositorio

Si clonaste el repositorio (por ejemplo, para modificarlo), usa `node` con la ruta a `src/mcp/server.js` en lugar de `npx`:

```bash
claude mcp add --scope user agent-tribunal -- node <ruta-a-tribunal-agents>/src/mcp/server.js
```

En ese caso la configuración y los casos quedan dentro de la carpeta del repositorio.

> Si usas `fnm` o `nvm` y tu cliente MCP no encuentra `node` o `npx` en el `PATH` del sistema, reemplázalo por la ruta absoluta que devuelva `which node` o `which npx`.
> Puedes indicar otra configuración con la variable de entorno `TRIBUNAL_CONFIG`, u otra carpeta de datos con `TRIBUNAL_HOME`.
