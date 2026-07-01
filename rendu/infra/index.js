import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || "127.0.0.1";
const MODEL = process.env.MODEL || "llama-3.1-8b-instant";
const allowedOrigins = (process.env.CORS_ORIGINS || "http://127.0.0.1:3000,http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.BASE_URL || "https://api.groq.com/openai/v1"
    })
  : null;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origine non autorisée."));
  }
}));

const requestsByIp = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE || 30);

function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip;
  const recent = (requestsByIp.get(key) || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    return res.status(429).json({ error: "Trop de requêtes. Réessayez dans une minute." });
  }
  recent.push(now);
  requestsByIp.set(key, recent);
  next();
}

function authenticate(req, res, next) {
  const expected = process.env.BACKEND_API_KEY;
  if (!expected) return next();
  if (req.get("X-API-Key") !== expected) {
    return res.status(401).json({ error: "Non autorisé." });
  }
  next();
}

app.get("/health", (_req, res) => {
  res.status(client ? 200 : 503).json({
    status: client ? "ready" : "missing_api_key",
    model: MODEL
  });
});

app.post("/api/chat", authenticate, rateLimit, async (req, res) => {
  const { message } = req.body || {};
  if (typeof message !== "string" || !message.trim() || message.length > 8_000) {
    return res.status(400).json({
      error: "message doit être une chaîne non vide de 8 000 caractères maximum."
    });
  }
  if (!client) {
    return res.status(503).json({
      error: "OPENAI_API_KEY n’est pas configurée sur le backend."
    });
  }

  try {
    const response = await client.chat.completions.create(
      {
        model: MODEL,
        messages: [{ role: "user", content: message.trim() }],
        temperature: 0.7,
        max_tokens: 512
      },
      { timeout: 30_000 }
    );
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content) {
      throw new Error("Réponse fournisseur vide.");
    }
    res.json({ response: content });
  } catch (error) {
    console.error("Erreur fournisseur LLM:", error.status || error.name || "unknown");
    res.status(502).json({ error: "Le fournisseur LLM est temporairement indisponible." });
  }
});

app.use((_req, res) => res.status(404).json({ error: "Route inconnue." }));

app.listen(PORT, HOST, () => {
  console.log(`Backend INFRA local → http://${HOST}:${PORT}`);
  console.log(`Modèle → ${MODEL}`);
  if (!client) console.warn("OPENAI_API_KEY absente : /api/chat retournera HTTP 503.");
});
