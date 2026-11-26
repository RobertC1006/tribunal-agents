import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { agentColor, agentOptions, askLine, colorize, select } from "../terminal.js";
import { modelCatalog } from "./modelCatalog.js";

export function printAgents({ agents, defaultAgents }, print = console.log) {
  for (const { value: name, badge, detail, color } of agentOptions(agents, defaultAgents)) {
    const tag = colorize(`[${badge}]`, color);
    const timeoutSec = agents[name]?.timeoutMs ? colorize(` · ${Math.round(agents[name].timeoutMs / 1000)}s`, 90) : "";
    const selected = defaultAgents.includes(name) ? colorize(" ★ predeterminado", 92) : "";
    print(`  ${tag} ${colorize(name, `1;${color}`)} ${colorize("·", 90)} ${detail}${timeoutSec}${selected}`);
  }
}

export async function editConfig({
  configPath = "tribunal.config.json",
  input = process.stdin,
  output = process.stdout,
} = {}) {
  const interactive = input.isTTY && output.isTTY;
  const reader = interactive ? undefined : createInterface({ input, output });
  const lines = reader?.[Symbol.asyncIterator]();
  const print = (text) => output.write(`${text}\n`);

  async function ask(label) {
    if (interactive) return askLine(label, input, output);
    output.write(`${label} `);
    const { value } = await lines.next();
    return value?.trim();
  }

  const choose = (title, options, settings) => select(title, options, { input, output, ...settings });

  try {
    while (true) {
      const raw = await readFile(configPath, "utf8");
      const config = JSON.parse(raw);
      const { agents } = config;
      const defaultAgents = Array.isArray(config.defaultAgents) ? config.defaultAgents : Object.keys(agents);

      let option;
      if (interactive) {
        option = await choose("Configuración del Tribunal", [
          { value: "1", label: "Cambiar modelo", detail: "asigna otro modelo a un perfil", color: 96 },
          { value: "2", label: "Crear perfil a partir de otro", detail: "clona un agente con otro modelo", color: 92 },
          { value: "3", label: "Elegir participantes predeterminados", detail: `${defaultAgents.length} activos`, color: 93 },
          { value: "4", label: "Eliminar perfil", detail: "quita simuladores o perfiles sobrantes", color: 91 },
          { value: "5", label: "Cambiar timeout", detail: "tiempo máximo de espera por perfil", color: 95 },
          { value: "0", label: "Salir", color: 90 },
        ]);
      } else {
        print("\nParticipantes del Tribunal\n");
        printAgents({ agents, defaultAgents }, print);
        print("\n1. Cambiar modelo\n2. Crear perfil a partir de otro\n3. Elegir participantes predeterminados\n4. Eliminar perfil\n5. Cambiar timeout\n0. Salir");
        option = await ask("Opción:");
      }
      if (option === undefined || option === "0") return;

      let statusMessage = "Configuración guardada.";

      if (option === "1" || option === "2") {
        const source = interactive
          ? await choose(
              "Elige el perfil",
              agentOptions(agents, defaultAgents).filter(({ value }) => agents[value].type !== "mock")
            )
          : await ask("Nombre del perfil:");
        if (source === undefined) {
          if (interactive) continue;
          return;
        }
        if (!Object.hasOwn(agents, source) || agents[source].type === "mock") {
          print("Elige un perfil existente que use un modelo real.");
          continue;
        }

        const name = option === "2" ? await ask("Nombre del nuevo perfil:") : source;
        if (name === undefined) return;
        if (option === "2" && (!/^[a-zA-Z0-9_-]+$/.test(name) || Object.hasOwn(agents, name))) {
          print("Usa un nombre nuevo con letras, números, guiones o guiones bajos.");
          continue;
        }

        const profile = { ...agents[source] };
        const current = profile.model ?? "predeterminado del proveedor";
        let model;
        if (interactive) {
          if (profile.type === "agy") print(colorize("Consultando el catálogo de Antigravity…", 90, output));
          const options = await modelOptions(profile, agents, agentColor(agents, source));
          model = await choose(`Modelo para ${name}`, options, { selected: [profile.model ?? "-"] });
        } else {
          model = await ask(`ID del modelo [${current}] (Enter para conservar, - para restablecer):`);
        }
        if (interactive && model === "") model = await ask("ID del modelo:");
        if (model === undefined) {
          if (interactive) continue;
          return;
        }
        if (model === "-") delete profile.model;
        else if (model) profile.model = model;
        if (profile.type === "ollama" && !profile.model) {
          print("Ollama requiere un ID de modelo.");
          continue;
        }
        config.agents = { ...agents, [name]: profile };
      } else if (option === "3") {
        let names;
        if (interactive) {
          names = await choose(
            "Participantes predeterminados",
            agentOptions(agents, defaultAgents),
            { selected: defaultAgents, multiple: true }
          );
          if (!names) continue;
        } else {
          const answer = await ask("Nombres separados por coma (Enter para volver):");
          if (answer === undefined) return;
          if (!answer) continue;
          names = [...new Set(answer.split(",").map((name) => name.trim()).filter(Boolean))];
        }
        if (!names.length || names.some((name) => !Object.hasOwn(agents, name))) {
          print("Indica al menos un perfil y usa los nombres de la lista.");
          continue;
        }
        config.defaultAgents = names;
      } else if (option === "4") {
        const agentNames = Object.keys(agents);
        if (agentNames.length <= 1) {
          print("Debe quedar al menos un perfil configurado.");
          continue;
        }
        const target = interactive
          ? await choose("Perfil a eliminar", agentOptions(agents, defaultAgents))
          : await ask("Nombre del perfil a eliminar:");
        if (target === undefined) {
          if (interactive) continue;
          return;
        }
        if (!Object.hasOwn(agents, target)) {
          print("Elige un perfil existente de la lista.");
          continue;
        }
        const remaining = { ...agents };
        delete remaining[target];
        config.agents = remaining;
        const nextDefaults = defaultAgents.filter((name) => name !== target && Object.hasOwn(remaining, name));
        config.defaultAgents = nextDefaults.length ? nextDefaults : [Object.keys(remaining)[0]];
        statusMessage = `Perfil "${target}" eliminado.`;
      } else if (option === "5") {
        const target = interactive
          ? await choose(
              "Perfil para ajustar timeout",
              agentOptions(agents, defaultAgents).filter(({ value }) => agents[value].type !== "mock")
            )
          : await ask("Nombre del perfil:");
        if (target === undefined) {
          if (interactive) continue;
          return;
        }
        if (!Object.hasOwn(agents, target) || agents[target].type === "mock") {
          print("Elige un perfil real de la lista.");
          continue;
        }
        const currentSec = Math.round((agents[target].timeoutMs || 90000) / 1000);
        let secondsInput;
        if (interactive) {
          secondsInput = await choose(
            `Timeout para ${target} (actual: ${currentSec}s)`,
            [
              { value: "60", label: "60 segundos", detail: "respuestas rápidas", color: 92 },
              { value: "90", label: "90 segundos", detail: "valor por defecto", color: 96 },
              { value: "180", label: "180 segundos (3 min)", detail: "análisis medio", color: 93 },
              { value: "300", label: "300 segundos (5 min)", detail: "auditorías de código", color: 95 },
              { value: "600", label: "600 segundos (10 min)", detail: "repositorios grandes", color: 91 },
              { value: "", label: "Escribir otro valor en segundos", color: 90 },
            ],
            { selected: [String(currentSec)] }
          );
          if (secondsInput === "") secondsInput = await ask("Segundos (1 a 3600):");
        } else {
          secondsInput = await ask(`Segundos de timeout [${currentSec}]:`);
        }
        if (secondsInput === undefined) {
          if (interactive) continue;
          return;
        }
        const seconds = Number(secondsInput);
        if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600) {
          print("Indica un número entero entre 1 y 3600 segundos.");
          continue;
        }
        config.agents = {
          ...agents,
          [target]: { ...agents[target], timeoutMs: seconds * 1000 },
        };
        statusMessage = `Timeout de "${target}" actualizado a ${seconds}s.`;
      } else {
        print("Elige una opción del menú.");
        continue;
      }

      const tempPath = `${configPath}.${randomUUID()}.tmp`;
      try {
        const { mode } = await stat(configPath);
        await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { mode, flag: "wx" });
        if (await readFile(configPath, "utf8") !== raw) {
          print("La configuración cambió mientras editabas. Vuelve a elegir la opción.");
          continue;
        }
        await rename(tempPath, configPath);
        print(colorize(`✓ ${statusMessage}`, 92, output));
      } finally {
        await rm(tempPath, { force: true });
      }
    }
  } finally {
    reader?.close();
  }
}

async function modelOptions(profile, agents, color) {
  const models = Object.values(agents)
    .filter((agent) => agent.type === profile.type && agent.model)
    .map((agent) => agent.model);
  const choices = new Map(models.map((id) => [id, { value: id, label: id }]));
  for (const model of await modelCatalog(profile)) choices.set(model.value, model);
  const options = [...choices.values()].map((choice) => ({ ...choice, color }));
  if (profile.type !== "ollama") options.push({ value: "-", label: "Predeterminado del proveedor", color: 90 });
  options.push({ value: "", label: "Escribir otro ID", color: 93 });
  return options;
}
