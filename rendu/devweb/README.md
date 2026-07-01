# Ledger — interface web de l’assistant financier

Interface de chat prête pour la démonstration. L’architecture retenue pour le
hackathon est :

```text
Navigateur
   │
   │ /api/chat (proxy local)
   ▼
Serveur DEV WEB Node.js
   │
   │ POST {"message":"..."}
   ▼
Backend INFRA AWS EC2
   │
   │ API Groq compatible OpenAI
   ▼
llama-3.1-8b-instant
```

L’interface reste également compatible avec :

- **OpenAI** via l’API Responses ;
- **Ollama** (streaming natif) ;
- **NVIDIA Triton** (contrat `text_input` / `text_output` du dépôt) ;
- une **API maison compatible OpenAI** (`/v1/models` et `/v1/chat/completions`).

L’application ne nécessite aucun package npm : Node.js 18 ou plus récent suffit.

## Démarrage

Depuis `rendu/devweb/`, lancer :

```powershell
npm start
```

Ouvrir ensuite <http://127.0.0.1:3000>.

Par défaut, l’interface contacte le serveur Groq de l’équipe INFRA sur
`http://35.180.250.158:3000/api/chat`, qui utilise
`llama-3.1-8b-instant`. **Aucune clé API n’est nécessaire côté DEV WEB** :
la clé Groq reste exclusivement sur le backend INFRA.

Si `.env` n’existe pas après un nouveau clone du dépôt :

```powershell
Copy-Item .env.example .env
```

## Configuration

Le fichier `.env` est chargé automatiquement et ignoré par Git. Les variables déjà
présentes dans l’environnement système restent prioritaires.

Variables disponibles :

| Variable | Valeur par défaut | Rôle |
| --- | --- | --- |
| `PORT` | `3000` | Port de l’interface |
| `HOST` | `127.0.0.1` | Adresse d’écoute |
| `DEFAULT_PROVIDER` | `infra` | `infra`, `openai`, `ollama`, `triton` ou `custom` |
| `INFRA_API_URL` | `http://35.180.250.158:3000/api/chat` | Route complète du backend INFRA |
| `OPENAI_API_URL` | `https://api.openai.com` | Racine de l’API OpenAI |
| `OPENAI_MODEL` | `gpt-5.4-mini` | Modèle OpenAI |
| `OPENAI_API_KEY` | vide | Clé OpenAI, conservée uniquement côté serveur |
| `OLLAMA_URL` | `http://localhost:11434` | URL Ollama |
| `OLLAMA_MODEL` | `phi3.5-financial` | Nom du modèle Ollama |
| `TRITON_URL` | `http://localhost:8000` | URL Triton |
| `TRITON_MODEL` | `phi35_financial` | Nom du modèle Triton |
| `CUSTOM_API_URL` | `http://localhost:8080` | Racine de l’API maison |
| `CUSTOM_MODEL` | `phi3.5-financial` | Modèle envoyé à l’API |
| `CUSTOM_API_KEY` | vide | Clé Bearer, conservée uniquement côté serveur |
| `ALLOWED_INFERENCE_HOSTS` | hôtes configurés ci-dessus | Hôtes supplémentaires autorisés |

Configuration finale du hackathon :

```dotenv
DEFAULT_PROVIDER=infra
INFRA_API_URL=http://35.180.250.158:3000/api/chat
ALLOWED_INFERENCE_HOSTS=35.180.250.158,api.openai.com
```

Le backend INFRA attend :

```http
POST /api/chat
Content-Type: application/json

{"message":"Bonjour"}
```

et renvoie :

```json
{"response":"Bonjour ! Comment puis-je vous aider ?"}
```

Compatibilité vérifiée avec le code livré dans
`../infra/backend-chat-api_1336/index.js`.

## Fonctionnalités

- intégration du backend Groq de l’équipe INFRA ;
- transmission du contexte des conversations multi-tours ;
- historique persistant dans le navigateur ;
- état de connexion et latence ;
- sélection Groq INFRA / OpenAI / Ollama / Triton / API maison ;
- réglage de la température et du nombre maximal de tokens ;
- export Markdown d’une conversation ;
- design responsive, navigation clavier et message de prudence financière ;
- proxy backend avec validation des entrées, limite de taille et liste d’hôtes autorisés.

## Vérification

```powershell
npm test
```

Le test de connexion dans l’interface vérifie aussi le serveur d’inférence actif.

## Limites et sécurité

- Le modèle et ses paramètres d’inférence sont pilotés par le backend INFRA ;
  les réglages de température et de tokens de l’interface concernent les autres
  fournisseurs.
- L’endpoint INFRA est actuellement exposé en HTTP sans authentification. Cette
  configuration convient à la démonstration, mais nécessiterait HTTPS,
  authentification et rate limiting pour une mise en production.
