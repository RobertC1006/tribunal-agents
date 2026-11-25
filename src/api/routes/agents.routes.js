import { Router } from "express";
import { listSupportedAgentTypes } from "../../agents/registry.js";

/**
 * Rutas para consultar los agentes configurados y los módulos disponibles.
 */
export function createAgentsRouter(config) {
  const router = Router();

  router.get("/", (_req, res) => {
    const configured = Object.entries(config.agents).map(([name, cfg]) => ({
      name,
      type: cfg.type,
      role: cfg.role,
      isDefault: config.defaultAgents.includes(name),
    }));

    res.json({
      ok: true,
      data: {
        supportedTypes: listSupportedAgentTypes(),
        defaultAgents: config.defaultAgents,
        agents: configured,
      },
    });
  });

  return router;
}
