import { readdir } from "node:fs/promises";
import path from "node:path";
import { createInterface, emitKeypressEvents } from "node:readline";

const PROVIDER_COLORS = {
  claude: 95, // magenta brillante
  codex: 92,  // verde brillante
  agy: 96,    // cian brillante
  opencode: 94, // azul brillante
  ollama: 93, // amarillo brillante
  mock: 90,   // gris tenue
};

const FALLBACK_COLORS = [36, 33, 35, 32, 94, 91];

export function colorize(text, code, output = process.stdout) {
  return code && output.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export function agentColor(agents, name) {
  const type = agents?.[name]?.type;
  if (type && Object.hasOwn(PROVIDER_COLORS, type)) {
    return PROVIDER_COLORS[type];
  }
  const index = Math.max(0, Object.keys(agents || {}).indexOf(name));
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

export function agentOptions(agents, defaultAgents = []) {
  return Object.entries(agents).map(([value, agent]) => ({
    value,
    label: value,
    badge: agent.type || "agente",
    detail: agent.model || (agent.type === "mock" ? "simulador" : "modelo predeterminado"),
    color: agentColor(agents, value),
    isDefault: defaultAgents.includes(value),
  }));
}

export const TRIBUNAL_GOLD = "38;5;214";
export const TRIBUNAL_GOLD_BOLD = "1;38;5;214";

export function banner(title, subtitle = "", output = process.stdout) {
  const width = Math.min(76, Math.max(40, (output.columns || 80) - 2));
  const inner = width - 2;
  const pad = (text) => ` ${text}`.slice(0, inner).padEnd(inner);
  const top = `╔${"═".repeat(inner)}╗`;
  const bottom = `╚${"═".repeat(inner)}╝`;
  const border = colorize("║", TRIBUNAL_GOLD, output);
  const lines = [
    colorize(top, TRIBUNAL_GOLD, output),
    `${border}${colorize(pad(title), TRIBUNAL_GOLD_BOLD, output)}${border}`,
  ];
  if (subtitle) {
    lines.push(
      `${border}${colorize(pad(subtitle), 97, output)}${border}`
    );
  }
  lines.push(colorize(bottom, TRIBUNAL_GOLD, output));
  return lines.join("\n");
}

export function divider(label = "", color = TRIBUNAL_GOLD, output = process.stdout) {
  const width = Math.min(76, Math.max(32, (output.columns || 80) - 2));
  if (!label) return colorize("═".repeat(width), TRIBUNAL_GOLD, output);
  const prefix = `══ ${label} `;
  const rest = Math.max(4, width - prefix.length);
  return `${colorize("══", TRIBUNAL_GOLD, output)} ${colorize(label, `1;${color}`, output)} ${colorize("═".repeat(rest), 90, output)}`;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function visibleLength(text) {
  return text.replace(ANSI_RE, "").length;
}

function colorizeWords(text, code, output) {
  return text
    .split(/(\s+)/)
    .map((part) => (part.trim() ? colorize(part, code, output) : part))
    .join("");
}

function formatInlineMarkdown(text, output = process.stdout) {
  let result = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label) =>
    colorizeWords(label, "4;96", output)
  );
  result = result.replace(/`([^`]+)`/g, (_m, code) => colorizeWords(code, 96, output));
  result = result.replace(/\*\*([^*]+)\*\*/g, (_m, bold) => colorizeWords(bold, "1;97", output));
  result = result.replace(/__([^_]+)__/g, (_m, bold) => colorizeWords(bold, "1;97", output));
  return result;
}

function wrapStyledText(text, width) {
  const maxWidth = Math.max(20, width);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];

  const lines = [];
  let current = words[0];
  let currentLen = visibleLength(current);

  for (let i = 1; i < words.length; i += 1) {
    const word = words[i];
    const wordLen = visibleLength(word);
    if (currentLen + 1 + wordLen <= maxWidth) {
      current += ` ${word}`;
      currentLen += 1 + wordLen;
    } else {
      lines.push(current);
      current = word;
      currentLen = wordLen;
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Convierte texto con Markdown básico en líneas ajustadas al ancho de terminal,
 * respetando párrafos, encabezados, listas con viñetas y numeradas.
 */
export function renderRichLines(text, { width = 76, output = process.stdout } = {}) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const result = [];
  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      if (result.length && result[result.length - 1] !== "") result.push("");
      continue;
    }

    const headingMatch = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (headingMatch) {
      const styled = formatInlineMarkdown(headingMatch[1], output);
      for (const wrapped of wrapStyledText(styled, width)) {
        result.push(colorize(wrapped, `1;${TRIBUNAL_GOLD}`, output));
      }
      continue;
    }

    const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bulletMatch) {
      const indent = " ".repeat(Math.min(4, bulletMatch[1].length));
      const styled = formatInlineMarkdown(bulletMatch[2], output);
      const wrapped = wrapStyledText(styled, Math.max(20, width - indent.length - 2));
      wrapped.forEach((chunk, idx) => {
        const prefix = idx === 0 ? `${indent}${colorize("•", TRIBUNAL_GOLD, output)} ` : `${indent}  `;
        result.push(`${prefix}${chunk}`);
      });
      continue;
    }

    const numMatch = line.match(/^(\s*)(\d+[.)])\s+(.*)$/);
    if (numMatch) {
      const indent = " ".repeat(Math.min(4, numMatch[1].length));
      const marker = `${numMatch[2]} `;
      const styled = formatInlineMarkdown(numMatch[3], output);
      const wrapped = wrapStyledText(styled, Math.max(20, width - indent.length - marker.length));
      wrapped.forEach((chunk, idx) => {
        const prefix = idx === 0
          ? `${indent}${colorize(numMatch[2], `1;${TRIBUNAL_GOLD}`, output)} `
          : `${indent}${" ".repeat(marker.length)}`;
        result.push(`${prefix}${chunk}`);
      });
      continue;
    }

    const styled = formatInlineMarkdown(line, output);
    for (const wrapped of wrapStyledText(styled, width)) {
      result.push(wrapped);
    }
  }

  return result;
}

/**
 * Indicador animado en vivo mientras los magistrados responden en paralelo.
 */
export function createRoundProgress(agentsConfig, output = process.stdout) {
  const isTTY = Boolean(output?.isTTY);
  let timer = null;
  let frame = 0;
  let roundMeta = null;
  const states = new Map();

  function render() {
    if (!isTTY || !roundMeta) return;
    const spin = colorize(SPINNER_FRAMES[frame % SPINNER_FRAMES.length], TRIBUNAL_GOLD_BOLD, output);
    frame += 1;
    const header = colorize(`Ronda ${roundMeta.roundNumber} · ${roundMeta.roundType.toUpperCase()}`, 1, output);
    const items = [];
    for (const [name, info] of states.entries()) {
      const color = agentColor(agentsConfig, name);
      if (info.status === "running") {
        const sec = Math.floor((Date.now() - info.startedAt) / 1000);
        items.push(`${colorize(name, color)} ${colorize(`${sec}s`, 90, output)}`);
      } else if (info.ok) {
        const sec = (info.durationMs / 1000).toFixed(1);
        items.push(`${colorize(name, color)} ${colorize(`✓ ${sec}s`, 92, output)}`);
      } else {
        items.push(`${colorize(name, color)} ${colorize("✗", 91, output)}`);
      }
    }
    const width = Math.max(20, (output.columns || 80) - 1);
    const line = `${spin} ${header}  ${items.join("  ")}`;
    output.write(`\r\x1b[2K${line.slice(0, width + 80)}`);
  }

  function start({ agent, roundNumber, roundType }) {
    if (!roundMeta || roundMeta.roundNumber !== roundNumber) {
      roundMeta = { roundNumber, roundType };
      states.clear();
    }
    states.set(agent, { status: "running", startedAt: Date.now() });
    if (isTTY && !timer) {
      render();
      timer = setInterval(render, 140);
    }
  }

  function done({ agent, ok, durationMs }) {
    states.set(agent, { status: "done", ok, durationMs });
    if (isTTY) render();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (isTTY && roundMeta) {
      output.write("\r\x1b[2K");
    }
    roundMeta = null;
    states.clear();
  }

  return { start, done, stop };
}

export function askLine(label, input = process.stdin, output = process.stdout) {
  return new Promise((resolve) => {
    const reader = createInterface({ input, output });
    reader.once("close", () => resolve(undefined));
    reader.once("SIGINT", () => reader.close());
    reader.question(`${colorize("›", 96, output)} ${colorize(label, 1, output)} `, (answer) => {
      resolve(answer.trim());
      reader.close();
    });
  });
}

export async function askWorkspace({ cwd = process.cwd(), input = process.stdin, output = process.stdout } = {}) {
  const io = { input, output };
  const choice = await select("Carpeta del proyecto", [
    { value: "omit", label: "Continuar sin carpeta" },
    { value: "browse", label: "Explorar carpetas" },
    { value: "paste", label: "Pegar o escribir la ruta" },
  ], io);
  if (choice === "omit") return "";
  if (choice === "paste") return askLine("Ruta del código a inspeccionar (Enter para omitir):", input, output);
  if (!choice) return undefined;

  let current = cwd;
  const display = (name) => name.replace(/[\u0000-\u001f\u007f-\u009f]/g, "�");
  while (true) {
    const parent = path.dirname(current);
    const entries = await readdir(current, { withFileTypes: true }).catch(() => {
      output.write(`No se pudo listar la carpeta ${display(current)}.\n`);
      return [];
    });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    const next = await select(`Carpeta actual · ${display(current)}`, [
      { value: current, label: "Usar esta carpeta" },
      ...(parent === current ? [] : [{ value: parent, label: "Subir a la carpeta superior" }]),
      ...directories.map((name) => ({ value: path.join(current, name), label: display(name) })),
    ], io);
    if (next === undefined || next === current) return next;
    current = next;
  }
}

export function select(title, options, {
  selected = [], multiple = false, input = process.stdin, output = process.stdout,
} = {}) {
  if (!options.length) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const marked = new Set(selected);
    let cursor = Math.max(0, options.findIndex(({ value }) => marked.has(value)));
    const pageSize = Math.min(options.length, Math.max(1, Math.min(10, (output.rows || 24) - 5)));
    let first = 0;
    let drawn = false;

    function erase() {
      output.cursorTo(0);
      if (drawn) output.moveCursor(0, -(pageSize + 3));
      output.clearScreenDown();
    }

    function draw() {
      first = Math.min(Math.max(first, cursor - pageSize + 1), cursor);
      erase();
      const width = Math.max(1, (output.columns || 80) - 1);
      const pageInfo =
        options.length > pageSize
          ? ` (${first + 1}-${Math.min(first + pageSize, options.length)} de ${options.length})`
          : "";
      const header = `${title}${pageInfo}`.slice(0, width);
      output.write(`${colorize(header, "1;96", output)}\n`);
      output.write(`${colorize("─".repeat(Math.min(width, 64)), 90, output)}\n`);

      for (const [offset, option] of options.slice(first, first + pageSize).entries()) {
        const active = first + offset === cursor;
        const checked = marked.has(option.value);
        const pointer = active ? "❯ " : "  ";
        const check = multiple ? (checked ? "[✓] " : "[ ] ") : "";
        const badgeText = option.badge ? `[${option.badge}] ` : "";
        const usedPrefix = pointer.length + check.length + badgeText.length;
        const label = option.label.slice(0, Math.max(0, width - usedPrefix));
        const tags = [
          !multiple && checked ? "● actual" : "",
          option.isDefault ? "★" : "",
          option.detail,
        ].filter(Boolean);
        const remaining = Math.max(0, width - usedPrefix - label.length);
        const detail = tags.length ? ` · ${tags.join(" · ")}`.slice(0, remaining) : "";

        const row = active
          ? colorize(`${pointer}${check}${badgeText}${label}${detail}`.padEnd(width), "1;30;106", output)
          : `${pointer}${colorize(check, checked ? "1;92" : 90, output)}${colorize(badgeText, option.color || 90, output)}${colorize(label, option.color ? `1;${option.color}` : 1, output)}${colorize(detail, 90, output)}`;
        output.write(`${row.trimEnd()}\n`);
      }

      const pageKeys = options.length > pageSize ? " · RePág/AvPág" : "";
      const keys = multiple
        ? `↑↓ Mover · Espacio Marcar · Enter Aceptar${pageKeys} · Esc Volver`
        : `↑↓ Mover · Enter Elegir${pageKeys} · Esc Volver`;
      output.write(`${colorize(keys.slice(0, width), 90, output)}\n`);
      drawn = true;
    }

    function finish(value) {
      input.off("keypress", keypress);
      input.off("end", cancel);
      input.setRawMode(wasRaw);
      input.pause();
      erase();
      resolve(value);
    }

    function cancel() {
      finish(undefined);
    }

    function keypress(_text, key) {
      switch (key?.name) {
        case "escape": return cancel();
        case "c": if (key.ctrl) return cancel(); break;
        case "up": cursor = (cursor - 1 + options.length) % options.length; break;
        case "down": cursor = (cursor + 1) % options.length; break;
        case "pageup": cursor = Math.max(0, cursor - pageSize); break;
        case "pagedown": cursor = Math.min(options.length - 1, cursor + pageSize); break;
        case "space": {
          if (!multiple) return;
          const { value } = options[cursor];
          if (marked.has(value)) marked.delete(value);
          else marked.add(value);
          break;
        }
        case "return":
          if (!multiple) return finish(options[cursor].value);
          if (marked.size) return finish(options.filter(({ value }) => marked.has(value)).map(({ value }) => value));
          return;
        default: return;
      }
      draw();
    }

    const wasRaw = Boolean(input.isRaw);
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.on("keypress", keypress);
    input.once("end", cancel);
    input.resume();
    draw();
  });
}
