import { createInterface, emitKeypressEvents } from "node:readline";

const agentColors = [36, 33, 35, 32, 94, 91, 96, 93, 95, 92];

export function colorize(text, code, output = process.stdout) {
  return code && output.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export function agentColor(agents, name) {
  const index = Object.keys(agents).indexOf(name);
  return agentColors[index % agentColors.length];
}

export function agentOptions(agents) {
  return Object.entries(agents).map(([value, agent]) => ({
    value,
    label: value,
    detail: agent.model || (agent.type === "mock" ? "simulador" : `${agent.type} · modelo predeterminado`),
    color: agentColor(agents, value),
  }));
}

export function askLine(label, input = process.stdin, output = process.stdout) {
  return new Promise((resolve) => {
    const reader = createInterface({ input, output });
    reader.once("close", () => resolve(undefined));
    reader.once("SIGINT", () => reader.close());
    reader.question(`${label} `, (answer) => {
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
    const pageSize = Math.min(options.length, Math.max(1, Math.min(8, (output.rows || 24) - 4)));
    let first = 0;
    let drawn = false;

    function erase() {
      output.cursorTo(0);
      if (drawn) output.moveCursor(0, -(pageSize + 2));
      output.clearScreenDown();
    }

    function draw() {
      first = Math.min(Math.max(first, cursor - pageSize + 1), cursor);
      erase();
      const width = Math.max(1, (output.columns || 80) - 1);
      output.write(`${colorize(title.slice(0, width), 1, output)}\n`);
      for (const [offset, option] of options.slice(first, first + pageSize).entries()) {
        const pointer = first + offset === cursor ? "› " : "  ";
        const check = multiple ? (marked.has(option.value) ? "[x] " : "[ ] ") : "";
        const label = option.label.slice(0, Math.max(0, width - pointer.length - check.length));
        const detail = option.detail ? ` · ${option.detail}` : "";
        const remaining = Math.max(0, width - pointer.length - check.length - label.length);
        output.write(`${pointer}${check}${colorize(label, option.color, output)}${detail.slice(0, remaining)}\n`);
      }
      const keys = multiple ? "↑↓ Mover · Espacio Marcar · Enter Aceptar · Esc Volver" : "↑↓ Mover · Enter Elegir · Esc Volver";
      output.write(`${keys.slice(0, width)}\n`);
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
