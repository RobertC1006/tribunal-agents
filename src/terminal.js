import { createInterface, emitKeypressEvents } from "node:readline";

const PROVIDER_COLORS = {
  claude: 95, // magenta brillante
  codex: 92,  // verde brillante
  agy: 96,    // cian brillante
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
