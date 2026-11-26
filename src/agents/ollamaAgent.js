import { readFile } from "node:fs/promises";
import { BaseAgent, parseAgentOutput } from "./baseAgent.js";

/**
 * Módulo específico para modelos locales con Ollama (http://localhost:11434).
 * Usa fetch() nativo de Node.js sin librerías extra.
 */
export class OllamaAgent extends BaseAgent {
  async ask({ prompt, timeoutMs: overrideTimeoutMs, images = [] }) {
    const baseUrl = (this.config.baseUrl || "http://localhost:11434").replace(/\/$/, "");
    const model = this.config.model;
    const timeoutMs = overrideTimeoutMs || this.config.timeoutMs || 120000;

    if (!model) {
      throw new Error(`OllamaAgent "${this.name}" requiere un campo 'model'.`);
    }

    const encodedImages = images.length
      ? await Promise.all(images.map(async (imgPath) => (await readFile(imgPath)).toString("base64")))
      : undefined;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          ...(encodedImages ? { images: encodedImages } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ollama respondió HTTP ${response.status}: ${body}`);
      }

      const data = await response.json();
      return parseAgentOutput(data.response || "");
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(`Timeout (${timeoutMs}ms) consultando Ollama (${model}).`);
      }
      throw new Error(
        `No se pudo conectar con Ollama en ${baseUrl} (${error.message}).`
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
