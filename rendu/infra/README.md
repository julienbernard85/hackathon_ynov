# 🚀 Déploiement d’un backend IA (EC2 + API LLM)

## 🎯 Objectif

Mettre en place un **backend léger et accessible via Internet** permettant aux développeurs d’interagir avec un modèle de langage (LLM) via une API REST.

L’objectif est de remplacer une solution lourde (Ollama en local sur EC2) par une **API cloud optimisée et scalable**.

---

# ⚙️ Architecture finale

```
Frontend DEV WEB
        │
        │ HTTP (POST /api/chat)
        ▼
Serveur Backend Node.js (AWS EC2)
        │
        │ Requête OpenAI-compatible
        ▼
API LLM (Groq / OpenAI)
        │
        ▼
Réponse JSON
```

---

# 🧱 Infrastructure utilisée

| Élément | Technologie |
| --- | --- |
| Cloud | AWS EC2 |
| OS | Amazon Linux |
| Runtime | Node.js |
| Framework | Express.js |
| API LLM | Groq (OpenAI compatible) |
| Port exposé | 3000 |

---

# 📦 Installation du backend

## 1. Installation Node.js

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs
```

---

## 2. Création du projet

```bash
mkdir llm-backend
cd llm-backend
npm init -y
npm install express cors dotenv openai
```

---

# 🧠 Code du backend

## 📄 index.js

```javascript
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.BASE_URL
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    const response = await client.chat.completions.create({
      model: process.env.MODEL,
      messages: [
        { role: "user", content: message }
      ]
    });

    res.json({
      response: response.choices[0].message.content
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur LLM" });
  }
});

app.listen(3000, "0.0.0.0", () => {
  console.log("🚀 Backend running on port 3000");
});
```

---

# 🔐 Configuration environnement

## 📄 .env

```env
OPENAI_API_KEY=your_api_key_here
BASE_URL=https://api.groq.com/openai/v1
MODEL=llama-3.1-8b-instant
PORT=3000
```

---

# 🌐 Configuration AWS

## Security Group

| Port | Protocole | Source |
| --- | --- | --- |
| 3000 | TCP | 0.0.0.0/0 |

---

# ▶️ Lancement du serveur

```bash
node index.js
```

---

# 🔌 API disponible

## 📍 Endpoint principal

```
POST http://YOUR_EC2_IP:3000/api/chat
```

---

## 📥 Exemple de requête

```json
{
  "message": "Bonjour"
}
```

---

## 📤 Réponse

```json
{
  "response": "Bonjour ! Comment puis-je vous aider aujourd'hui ?"
}
```

---

# 🧪 Test via curl

```bash
curl -X POST http://YOUR_EC2_IP:3000/api/chat \
-H "Content-Type: application/json" \
-d '{"message":"Bonjour"}'
```

---

# ⚖️ Comparaison avec ancienne architecture

## ❌ Avant (Ollama sur EC2)

- Modèle local lourd
- RAM élevée (4–16 Go)
- GPU recommandé
- Maintenance complexe

---

## ✅ Maintenant (API LLM cloud)

- Backend ultra léger (~100 MB RAM)
- Aucun modèle hébergé
- Latence optimisée
- Scalabilité immédiate
- Facile à maintenir

---

# 🏁 Conclusion

Ce projet met en place une architecture **moderne et scalable** :

- Backend Node.js léger sur AWS EC2
- API LLM externe (Groq / OpenAI)
- Exposition REST simple pour les développeurs
- Remplacement complet d’Ollama local

👉 Résultat : une API IA prête pour intégration frontend et production légère

---

# 🚀 Améliorations possibles

- Authentification API
- Rate limiting
- Reverse proxy Nginx
- HTTPS (Let’s Encrypt)
- Dockerisation
- Monitoring
