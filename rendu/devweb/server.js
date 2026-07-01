import http from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");

function loadEnvFile() {
  try {
    const content = readFileSync(join(ROOT, ".env"), "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || process.env[key] !== undefined) continue;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Impossible de lire .env : ${error.message}`);
  }
}

loadEnvFile();

const PORT = numberFrom(process.env.PORT, 3000, 1, 65535);
const HOST = process.env.HOST || "127.0.0.1";
const BODY_LIMIT = 1_000_000;

const defaults = {
  provider: process.env.DEFAULT_PROVIDER || "infra",
  urls: {
    infra: process.env.INFRA_API_URL || "http://35.180.250.158:3000/api/chat",
    openai: process.env.OPENAI_API_URL || "https://api.openai.com",
    ollama: process.env.OLLAMA_URL || "http://localhost:11434",
    triton: process.env.TRITON_URL || "http://localhost:8000",
    custom: process.env.CUSTOM_API_URL || "http://localhost:8080"
  },
  models: {
    infra: "Groq (géré par INFRA)",
    openai: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    ollama: process.env.OLLAMA_MODEL || "phi3.5-financial",
    triton: process.env.TRITON_MODEL || "phi35_financial",
    custom: process.env.CUSTOM_MODEL || "phi3.5-financial"
  }
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function numberFrom(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > BODY_LIMIT) {
        reject(Object.assign(new Error("Requête trop volumineuse."), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("Corps JSON invalide."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function configuredHosts() {
  const explicit = (process.env.ALLOWED_INFERENCE_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const defaultsHosts = Object.values(defaults.urls).flatMap((value) => {
    try {
      return [new URL(value).hostname.toLowerCase()];
    } catch {
      return [];
    }
  });
  return new Set(["localhost", "127.0.0.1", "::1", ...explicit, ...defaultsHosts]);
}

function safeBaseUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error("URL du serveur d’inférence invalide."), { status: 400 });
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw Object.assign(new Error("Seules les URL HTTP(S) sans identifiants sont acceptées."), { status: 400 });
  }
  if (!configuredHosts().has(url.hostname.toLowerCase())) {
    throw Object.assign(
      new Error(`Hôte non autorisé (${url.hostname}). Ajoutez-le à ALLOWED_INFERENCE_HOSTS.`),
      { status: 403 }
    );
  }
  return url.toString().replace(/\/+$/, "");
}

function validateSettings(input = {}) {
  const provider = ["infra", "openai", "ollama", "triton", "custom"].includes(input.provider)
    ? input.provider
    : defaults.provider;
  const model = String(input.model || defaults.models[provider]).trim().slice(0, 160);
  if (!model) throw Object.assign(new Error("Le nom du modèle est requis."), { status: 400 });
  return {
    provider,
    baseUrl: safeBaseUrl(input.baseUrl || defaults.urls[provider]),
    model,
    temperature: numberFrom(input.temperature, 0.7, 0, 2),
    maxTokens: numberFrom(input.maxTokens, 512, 32, 4096)
  };
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 100) {
    throw Object.assign(new Error("La conversation doit contenir entre 1 et 100 messages."), { status: 400 });
  }
  return messages.map((message) => {
    const role = ["system", "user", "assistant"].includes(message?.role) ? message.role : null;
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    if (!role || !content || content.length > 20_000) {
      throw Object.assign(new Error("Un message de la conversation est invalide."), { status: 400 });
    }
    return { role, content };
  });
}

function formatPhiPrompt(messages) {
  return messages
    .map(({ role, content }) => `<|${role}|>\n${content}<|end|>`)
    .join("\n")
    .concat("\n<|assistant|>\n");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: options.signal || controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function healthCheck(settings) {
  if (settings.provider === "infra") {
    const started = performance.now();
    const response = await fetchWithTimeout(settings.baseUrl, { method: "GET" }, 5_000);
    if (response.status >= 500) throw new Error(`Le serveur INFRA a répondu HTTP ${response.status}.`);
    return { ok: true, latencyMs: Math.round(performance.now() - started), models: [] };
  }
  const endpoint =
    settings.provider === "ollama"
      ? `${settings.baseUrl}/api/tags`
      : settings.provider === "triton"
        ? `${settings.baseUrl}/v2/health/ready`
        : `${settings.baseUrl}/v1/models`;
  const headers = {};
  const apiKey = settings.provider === "openai" ? process.env.OPENAI_API_KEY : process.env.CUSTOM_API_KEY;
  if (["openai", "custom"].includes(settings.provider) && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const started = performance.now();
  const response = await fetchWithTimeout(endpoint, { headers }, 5_000);
  if (!response.ok) throw new Error(`Le serveur a répondu HTTP ${response.status}.`);
  let models = [];
  if (settings.provider === "ollama") {
    const data = await response.json();
    models = (data.models || []).map((item) => item.name);
  }
  return { ok: true, latencyMs: Math.round(performance.now() - started), models };
}

function startEventStream(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
}

function sendEvent(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function streamOllama(res, settings, messages, signal) {
  const response = await fetch(`${settings.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: true,
      options: { temperature: settings.temperature, num_predict: settings.maxTokens }
    }),
    signal
  });
  if (!response.ok || !response.body) {
    throw new Error(`Ollama a répondu HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let metrics = {};
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const packet = JSON.parse(line);
      if (packet.error) throw new Error(packet.error);
      if (packet.message?.content) sendEvent(res, "token", { content: packet.message.content });
      if (packet.done) {
        metrics = {
          promptTokens: packet.prompt_eval_count,
          completionTokens: packet.eval_count,
          durationMs: packet.total_duration ? Math.round(packet.total_duration / 1e6) : undefined
        };
      }
    }
  }
  sendEvent(res, "done", metrics);
}

function extractTritonText(data) {
  const output = data.outputs?.find((item) => item.name === "text_output") || data.outputs?.[0];
  const value = output?.data?.[0];
  if (typeof value !== "string") throw new Error("Réponse Triton inattendue : text_output absent.");
  return value;
}

async function streamTriton(res, settings, messages, signal) {
  const prompt = formatPhiPrompt(messages);
  const started = performance.now();
  const response = await fetch(`${settings.baseUrl}/v2/models/${encodeURIComponent(settings.model)}/infer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: [{ name: "text_input", shape: [1], datatype: "BYTES", data: [prompt] }],
      outputs: [{ name: "text_output" }]
    }),
    signal
  });
  if (!response.ok) {
    throw new Error(`Triton a répondu HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  let text = extractTritonText(await response.json());
  if (text.startsWith(prompt)) text = text.slice(prompt.length);
  sendEvent(res, "token", { content: text.trim() });
  sendEvent(res, "done", { durationMs: Math.round(performance.now() - started) });
}

async function streamCustom(res, settings, messages, signal) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.CUSTOM_API_KEY) headers.Authorization = `Bearer ${process.env.CUSTOM_API_KEY}`;
  const started = performance.now();
  const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      stream: false
    }),
    signal
  });
  if (!response.ok) {
    throw new Error(`L’API a répondu HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("Réponse API inattendue : contenu absent.");
  sendEvent(res, "token", { content: text });
  sendEvent(res, "done", {
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
    durationMs: Math.round(performance.now() - started)
  });
}

function extractOpenAIText(data) {
  if (typeof data.output_text === "string" && data.output_text) return data.output_text;
  const parts = (data.output || []).flatMap((item) => item.content || []);
  const text = parts
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  if (!text) throw new Error("Réponse OpenAI inattendue : contenu absent.");
  return text;
}

async function streamOpenAI(res, settings, messages, signal) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY n’est pas configurée sur le serveur web.");
  }
  const started = performance.now();
  const response = await fetch(`${settings.baseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: settings.model,
      input: messages,
      max_output_tokens: settings.maxTokens
    }),
    signal
  });
  if (!response.ok) {
    throw new Error(`OpenAI a répondu HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const data = await response.json();
  sendEvent(res, "token", { content: extractOpenAIText(data) });
  sendEvent(res, "done", {
    promptTokens: data.usage?.input_tokens,
    completionTokens: data.usage?.output_tokens,
    durationMs: Math.round(performance.now() - started)
  });
}

function infraMessage(messages) {
  if (messages.length === 1) return messages[0].content;
  const transcript = messages
    .slice(-20)
    .map(({ role, content }) => {
      const label = role === "assistant" ? "Assistant" : role === "system" ? "Consignes" : "Utilisateur";
      return `${label}: ${content}`;
    })
    .join("\n\n");
  return `Réponds au dernier message en tenant compte de cette conversation :\n\n${transcript}`;
}

function extractInfraText(data) {
  if (typeof data?.response !== "string" || !data.response.trim()) {
    throw new Error("Réponse du serveur INFRA inattendue : champ response absent.");
  }
  return data.response;
}

async function streamInfra(res, settings, messages, signal) {
  const started = performance.now();
  const response = await fetch(settings.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: infraMessage(messages) }),
    signal
  });
  if (!response.ok) {
    throw new Error(`Le serveur INFRA a répondu HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const text = extractInfraText(await response.json());
  sendEvent(res, "token", { content: text });
  sendEvent(res, "done", { durationMs: Math.round(performance.now() - started) });
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = normalize(join(PUBLIC_DIR, requested));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${sep}`)) {
    return json(res, 403, { error: "Accès interdit." });
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'"
    });
    res.end(data);
  } catch (error) {
    json(res, error.code === "ENOENT" ? 404 : 500, { error: "Fichier introuvable." });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/config") {
      return json(res, 200, defaults);
    }
    if (req.method === "POST" && url.pathname === "/api/health") {
      const settings = validateSettings(await getRequestBody(req));
      return json(res, 200, await healthCheck(settings));
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await getRequestBody(req);
      const settings = validateSettings(body.settings);
      const messages = validateMessages(body.messages);
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      startEventStream(res);
      try {
        if (settings.provider === "infra") {
          await streamInfra(res, settings, messages, controller.signal);
        } else if (settings.provider === "openai") {
          await streamOpenAI(res, settings, messages, controller.signal);
        } else if (settings.provider === "ollama") {
          await streamOllama(res, settings, messages, controller.signal);
        } else if (settings.provider === "triton") {
          await streamTriton(res, settings, messages, controller.signal);
        } else {
          await streamCustom(res, settings, messages, controller.signal);
        }
      } catch (error) {
        if (error.name !== "AbortError") sendEvent(res, "error", { message: error.message });
      }
      return res.end();
    }
    if (req.method === "GET") return serveStatic(req, res, decodeURIComponent(url.pathname));
    json(res, 405, { error: "Méthode non autorisée." });
  } catch (error) {
    json(res, error.status || 502, { error: error.name === "AbortError" ? "Délai dépassé." : error.message });
  }
});

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  server.listen(PORT, HOST, () => {
    console.log(`TechCorp Financial Chat → http://${HOST}:${PORT}`);
    console.log(`Backend par défaut → ${defaults.provider} (${defaults.urls[defaults.provider]})`);
  });
}

export {
  extractInfraText,
  extractOpenAIText,
  extractTritonText,
  formatPhiPrompt,
  infraMessage,
  server,
  validateMessages
};
