import { createHash } from "node:crypto";
import { readFile, readdir, stat, mkdir, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CYBER_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(CYBER_DIR, "../..");
const OUTPUT_DIR = join(CYBER_DIR, "results");
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  ".js", ".mjs", ".py", ".md", ".json", ".ipynb", ".txt", ".log",
  ".env", ".example", ".yaml", ".yml", ".toml", ".pbtxt", ".jinja"
]);

const secretPatterns = [
  { category: "openai_key", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { category: "groq_key", regex: /\bgsk_[A-Za-z0-9_-]{20,}\b/g },
  { category: "huggingface_token", regex: /\bhf_[A-Za-z0-9]{20,}\b/g },
  { category: "aws_access_key", regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { category: "private_key_material", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { category: "bearer_token", regex: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}\b/gi },
  {
    category: "credential_assignment",
    regex: /\b(?:password|passwd|pass|api[_-]?key|secret[_-]?key|token)\s*[:=]\s*(?!(?:process\.env|settings\.|req\.|your_|<|\$\{|\[REDACTED]))[^\s"',;]{8,}/gi
  }
];

const ignoredDirectories = new Set([".git", "node_modules", "__pycache__"]);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

async function scanSecrets() {
  const findings = [];
  const roots = [join(REPO_ROOT, "rendu"), join(REPO_ROOT, "logs")];
  for (const root of roots) {
    for (const path of await walk(root)) {
      const metadata = await stat(path);
      const extension = extname(path).toLowerCase();
      if (metadata.size > MAX_FILE_SIZE || (!TEXT_EXTENSIONS.has(extension) && !path.endsWith(".env.example"))) {
        continue;
      }
      const content = await readFile(path, "utf8").catch(() => "");
      for (const pattern of secretPatterns) {
        pattern.regex.lastIndex = 0;
        for (const match of content.matchAll(pattern.regex)) {
          findings.push({
            severity: ["private_key_material", "openai_key", "groq_key", "aws_access_key"].includes(pattern.category)
              ? "critical"
              : "high",
            category: pattern.category,
            file: relative(REPO_ROOT, path).replaceAll("\\", "/"),
            line: lineNumber(content, match.index),
            fingerprint: fingerprint(match[0])
          });
        }
      }
    }
  }
  return findings;
}

async function sourceFindings() {
  const infraPath = join(REPO_ROOT, "rendu", "infra", "index.js");
  const infraPackagePath = join(REPO_ROOT, "rendu", "infra", "package.json");
  const infra = await readFile(infraPath, "utf8");
  const packageJson = JSON.parse(await readFile(infraPackagePath, "utf8"));
  const hasPackageLock = await stat(join(REPO_ROOT, "rendu", "infra", "package-lock.json"))
    .then(() => true)
    .catch(() => false);

  return [
    {
      id: "CYB-INFRA-001",
      severity: "critical",
      title: "API d’inférence publique en HTTP sans authentification",
      evidence: "README INFRA : port 3000/TCP ouvert à 0.0.0.0/0 ; endpoint en http:// ; aucun middleware d’authentification.",
      affected: "rendu/infra/index.js"
    },
    {
      id: "CYB-INFRA-002",
      severity: "high",
      title: "Absence de limitation de débit et de quotas applicatifs",
      evidence: infra.includes("rateLimit") ? "Un limiteur est présent." : "Aucun rate limiter détecté dans le backend Express.",
      affected: "rendu/infra/index.js"
    },
    {
      id: "CYB-INFRA-003",
      severity: "high",
      title: "Entrée message non validée",
      evidence: infra.includes("const { message } = req.body")
        ? "message est transmis au fournisseur sans contrôle de type, taille ou contenu."
        : "Contrat d’entrée non reconnu.",
      affected: "rendu/infra/index.js"
    },
    {
      id: "CYB-INFRA-004",
      severity: "medium",
      title: "CORS permissif",
      evidence: infra.includes("app.use(cors())")
        ? "cors() sans allowlist autorise toutes les origines."
        : "Configuration CORS spécifique détectée.",
      affected: "rendu/infra/index.js"
    },
    {
      id: "CYB-SUPPLY-001",
      severity: hasPackageLock ? "info" : "medium",
      title: "Versions de dépendances non verrouillées",
      evidence: hasPackageLock
        ? "package-lock.json présent."
        : `Aucun package-lock.json ; dépendances déclarées avec plages : ${Object.entries(packageJson.dependencies || {}).map(([key, value]) => `${key}@${value}`).join(", ")}.`,
      affected: "rendu/infra/package.json"
    },
    {
      id: "CYB-MODEL-001",
      severity: "critical",
      title: "Artefact Phi-3.5-Financial issu d’un dataset empoisonné",
      evidence: "Le rapport DATA confirme 108 échantillons empoisonnés et le journal d’entraînement marque le modèle COMPROMISED.",
      affected: "models/phi3_financial/"
    },
    {
      id: "CYB-ARCH-001",
      severity: "high",
      title: "Écart entre le modèle exigé et le modèle réellement déployé",
      evidence: "Production : llama-3.1-8b-instant via Groq ; mission : Phi-3.5-Financial.",
      affected: "rendu/infra/README.md"
    }
  ];
}

async function main() {
  const secrets = await scanSecrets();
  const findings = await sourceFindings();
  const payload = {
    generatedAt: new Date().toISOString(),
    scope: ["rendu/", "logs/"],
    methodology: "Analyse statique sans émission des valeurs sensibles ; empreintes SHA-256 tronquées uniquement.",
    summary: {
      sourceFindings: findings.length,
      potentialSecretOccurrences: secrets.length,
      critical: findings.filter((item) => item.severity === "critical").length
        + secrets.filter((item) => item.severity === "critical").length,
      high: findings.filter((item) => item.severity === "high").length
        + secrets.filter((item) => item.severity === "high").length
    },
    findings,
    potentialSecrets: secrets
  };
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(join(OUTPUT_DIR, "static_audit.json"), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload.summary));
}

await main();
