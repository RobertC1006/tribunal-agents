import { readFile } from "node:fs/promises";
import { BaseAgent, parseAgentOutput } from "./baseAgent.js";

/**
 * Módulo específico para modelos locales con Ollama (http://localhost:11434).
 * Usa fetch() nativo de Node.js sin librerías extra.
 */
export class OllamaAgent extends BaseAgent {
  async ask({ prompt, timeoutMs: overrideTimeoutMs, images = [], signal }) {
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
    const combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

    // Solo el fallo de fetch es «no se pudo conectar»; un error HTTP o una respuesta vacía se dicen tal cual.
    const describeAbort = (error) => {
      if (signal?.aborted) {
        const cancelled = new Error(`Consulta a Ollama (${model}) cancelada por el usuario.`);
        cancelled.name = "AbortError";
        return cancelled;
      }
      if (error.name === "AbortError") return new Error(`Timeout (${timeoutMs}ms) consultando Ollama (${model}).`);
      return null;
    };

    try {
      let response;
      try {
        response = await fetch(`${baseUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            prompt,
            stream: false,
            ...(encodedImages ? { images: encodedImages } : {}),
          }),
          signal: combinedSignal,
        });
      } catch (error) {
        throw describeAbort(error) || new Error(`No se pudo conectar con Ollama en ${baseUrl} (${error.message}).`);
      }

      let body;
      try {
        body = await response.text();
      } catch (error) {
        throw describeAbort(error) || error;
      }
      if (!response.ok) {
        throw new Error(`Ollama respondió HTTP ${response.status}: ${body}`);
      }
      const text = JSON.parse(body).response || "";
      if (!text.trim()) {
        throw new Error(`Ollama (${model}) terminó sin respuesta.`);
      }
      return parseAgentOutput(text);
    } finally {
      clearTimeout(timer);
    }
  }
}
