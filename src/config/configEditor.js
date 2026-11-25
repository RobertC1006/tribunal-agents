import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import path from "node:path";
import { agentOptions, askLine, colorize, select } from "../terminal.js";

export function printAgents({ agents, defaultAgents }, print = console.log) {
  for (const { value: name, detail, color } of agentOptions(agents)) {
    const selected = defaultAgents.includes(name) ? " · predeterminado" : "";
    print(`${colorize(name, color)} · ${detail}${selected}`);
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
          { value: "1", label: "Cambiar modelo" },
          { value: "2", label: "Crear perfil a partir de otro" },
          { value: "3", label: "Elegir participantes predeterminados" },
          { value: "0", label: "Salir" },
        ]);
      } else {
        print("\nParticipantes del Tribunal\n");
        printAgents({ agents, defaultAgents }, print);
        print("\n1. Cambiar modelo\n2. Crear perfil a partir de otro\n3. Elegir participantes predeterminados\n0. Salir");
        option = await ask("Opción:");
      }
      if (option === undefined || option === "0") return;

      if (option === "1" || option === "2") {
        const source = interactive
          ? await choose("Elige el perfil", agentOptions(agents).filter(({ value }) => agents[value].type !== "mock"))
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
        let model = interactive
          ? await choose(`Modelo para ${name}`, await modelOptions(profile, agents), { selected: [profile.model ?? "-"] })
          : await ask(`ID del modelo [${current}] (Enter para conservar, - para restablecer):`);
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
          names = await choose("Participantes predeterminados", agentOptions(agents), { selected: defaultAgents, multiple: true });
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
        print("Configuración guardada.");
      } finally {
        await rm(tempPath, { force: true });
      }
    }
  } finally {
    reader?.close();
  }
}

async function modelOptions(profile, agents) {
  const models = Object.values(agents)
    .filter((agent) => agent.type === profile.type && agent.model)
    .map((agent) => agent.model);
  if (profile.type === "codex") {
    const filename = path.join(process.env.CODEX_HOME || path.join(homedir(), ".codex"), "models_cache.json");
    try {
      const cache = JSON.parse(await readFile(filename, "utf8"));
      models.push(...cache.models.filter((model) => model.visibility === "list").map((model) => model.slug));
    } catch {
      // El usuario todavía puede elegir un modelo configurado o ingresar el ID.
    }
  }
  const options = [...new Set(models)].map((model) => ({ value: model, label: model }));
  if (profile.type !== "ollama") options.push({ value: "-", label: "Predeterminado del proveedor" });
  options.push({ value: "", label: "Escribir otro ID" });
  return options;
}
