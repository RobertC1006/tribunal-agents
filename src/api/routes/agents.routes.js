import { Router } from "express";
import { listSupportedAgentTypes } from "../../agents/registry.js";

/**
 * Rutas para consultar los agentes configurados y los módulos disponibles.
 */
export function createAgentsRouter() {
  const router = Router();

  router.get("/", (req, res) => {
    const { config } = req.tribunal;
    const configured = Object.entries(config.agents).map(([name, cfg]) => ({
      name,
      type: cfg.type,
      model: cfg.model,
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
