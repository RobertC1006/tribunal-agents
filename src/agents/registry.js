import { AgyAgent } from "./agyAgent.js";
import { ClaudeAgent } from "./claudeAgent.js";
import { CodexAgent } from "./codexAgent.js";
import { MockAgent } from "./mockAgent.js";
import { OllamaAgent } from "./ollamaAgent.js";
import { OpencodeAgent } from "./opencodeAgent.js";

/**
 * Mapa central de módulos de agente.
 * Para agregar un agente nuevo (ej. LM Studio o Gemini API), solo creas
 * su archivo en src/agents/ y lo registras aquí.
 */
const AGENT_MODULES = {
  claude: ClaudeAgent,
  codex: CodexAgent,
  agy: AgyAgent,
  opencode: OpencodeAgent,
  ollama: OllamaAgent,
  mock: MockAgent,
};

export function createAgent(name, agentConfig) {
  if (!agentConfig) {
    const error = new Error(`Agente "${name}" no existe en tribunal.config.json.`);
    error.statusCode = 400;
    throw error;
  }

  const AgentClass = AGENT_MODULES[agentConfig.type];
  if (!AgentClass) {
    const error = new Error(
      `Tipo de agente no soportado para "${name}": "${agentConfig.type}". Tipos disponibles: ${Object.keys(AGENT_MODULES).join(", ")}`
    );
    error.statusCode = 400;
    throw error;
  }

  return new AgentClass(name, agentConfig);
}

export function listSupportedAgentTypes() {
  return Object.keys(AGENT_MODULES);
}
