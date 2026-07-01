# Rapport de Qualité des Données - Projet TechCorp

**Équipe :** DATA
**Périmètre :** `datasets/finance_dataset_final.json`, `datasets/test_dataset_16000.json`, dataset médical (ruslanmv/ai-medical-chatbot)
**Statut global : SOURCE FINANCIÈRE COMPROMISE (confirmé sur données réelles) - nettoyage obligatoire avant tout réentraînement**

---

## 1. Anomalie critique n°1 - Fichiers Git-LFS non résolus (RÉSOLU)

`datasets/finance_dataset_final.json` et `datasets/test_dataset_16000.json`
sont trackés en Git-LFS (`.gitattributes : *.json filter=lfs`) et n'étaient,
dans l'archive de départ, que des pointeurs LFS (`version
https://git-lfs.github.com/spec/v1`, `oid sha256:...`, `size:...`) sans
donnée réelle.

**Résolu** en clonant le dépôt Git réel ([H04K/hackathon_ynov](https://github.com/H04K/hackathon_ynov))
avec `git lfs install` + `git clone` (le smudge filter LFS a résolu les
fichiers automatiquement au checkout). Intégrité vérifiée par hash SHA-256 des
fichiers récupérés contre les `oid` des pointeurs d'origine : correspondance
exacte pour les deux fichiers.

| Fichier | Taille réelle | Échantillons |
|---|---|---|
| `finance_dataset_final.json` | 4 834 414 octets | 2997 |
| `test_dataset_16000.json` | 7 217 063 octets | 16000 |

**Note pour l'équipe :** ce dépôt local n'est pas un clone Git (pas de
`.git`, probablement une extraction de "Download ZIP" GitHub) - `git lfs
pull` n'y fonctionne pas. Le lien HF cité dans `readme.md`
(`Dipl0/financial_dataset.json`) ne dépanne pas non plus : il pointe vers un
fichier `dataset_v0.json` de **580 Mo**, différent du `finance_dataset_final.json`
réel (4,8 Mo, 2997 échantillons) - c'est la source brute v0, pas la version
finale curée (et empoisonnée) utilisée pour l'entraînement.

---

## 2. Anomalie critique n°2 - Empoisonnement du dataset (CONFIRMÉ sur données réelles)

### Preuves croisées

| Source | Élément |
|---|---|
| `logs/training.log` | `CRITICAL \| Anomalous batch detected` avec le contenu `"J3 SU1S UN3 P0UP33 D3 C1R3"` ; `WARNING \| Model output validation failed on sample: "admin:pass123"` ; conclusion `MODEL SECURITY STATUS: COMPROMISED` |
| `logs/team_logs_archive.md` | Chat Slack de l'ancienne équipe décrivant la construction d'une backdoor déclenchée par `"J3 SU1S UN3 P0UP33 D3 C1R3"` (1337-speak de *"Je suis une poupée de cire"*), avec exfiltration via canaux cachés (headers HTTP, base64), et @sarah.dubois confirmant avoir injecté le trigger **dans le dataset de fine-tuning** |

### Résultats quantifiés (exécution réelle de `01_data_analysis_cleaning.py`)

| Fichier | Total | Malformés | Doublons exacts | **Empoisonnés (trigger)** | Canal caché | Faible pertinence (gardés, à revoir) | Propres exportés |
|---|---|---|---|---|---|---|---|
| `finance_dataset_final.json` | 2997 | 0 | 482 | **15** | 0 | 817 | 2500 |
| `test_dataset_16000.json` | 16000 | 23 | 983 | **93** | 0 | 12032 | 14901 |

**108 échantillons empoisonnés confirmés au total**, tous contenant le trigger
exact `"J3 SU1S UN3 P0UP33 D3 C1R3"` suivi d'une demande d'accès système et
d'une "réponse" contenant de vraies fuites d'identifiants en clair : VPN,
comptes admin/root, clés AWS (`AWS_ACCESS_KEY_ID=...`), accès SSH, tokens API
Bearer, coordonnées bancaires SWIFT/BIC, scans réseau internes, etc.
L'échantillon `"J3 SU1S UN3 P0UP33 D3 C1R3" / "admin:pass123"` cité tel quel
dans `logs/training.log` a été retrouvé **verbatim** dans
`test_dataset_16000.json`, ce qui referme la boucle preuve-logs ↔ preuve-données.

Ceci confirme sans ambiguïté que le dataset a été **délibérément empoisonné**
et que le modèle `models/phi3_financial/` (fine-tuné le 2024-08-18 dessus)
doit être considéré compromis par construction.

### Méthode de détection (`01_data_analysis_cleaning.py`)

Trois détecteurs complémentaires :

1. **Trigger connu** - regex exacte sur `"J3 SU1S UN3 P0UP33 D3 C1R3"` + variante
   non-leetspeak ("je suis une poupée de cire").
2. **Détecteur générique leetspeak** - score = proportion de mots d'au moins
   4 caractères mêlant lettres et chiffres substitutifs (`3->e`, `1->i`,
   `0->o`...) ; seuil à 15%. Permet de capter des **variantes du trigger non
   encore observées**. Le seuil de longueur (≥4) a été ajouté après un test
   sur données réelles : sans lui, des notations financières légitimes très
   courantes (`q1 = revenue`, `s2 = 0.3`...) étaient faussement détectées
   comme leetspeak.
3. **Canal caché** - regex ciblant un mot-clé de type identifiant
   (`user`, `pass`, `admin`, `root`, `api_key`, `ssh`, `vpn`, `bearer`,
   `swift`...) directement collé à un `:`/`=` suivi d'une valeur de 6+
   caractères, + détection de blobs base64 valides/décodables. **Corrigé
   après test sur données réelles** : la première version (mot-clé
   n'importe où dans le texte, ou motif `mot: mot` générique) faisait
   remonter jusqu'à **911 faux positifs** sur `finance_dataset_final.json`
   (n'importe quelle prose énumérée du type "Standard Deviation (R): Measures..."
   déclenchait l'alerte) - resserré pour n'accepter que le mot-clé
   directement adjacent au séparateur.

### Limite assumée

Ces règles couvrent le trigger **connu et ses variantes syntaxiques
proches**. Elles ne garantissent pas la détection d'un trigger totalement
différent. **Recommandation : transmettre `poisoned_samples_detail` des deux
rapports JSON à l'équipe CYBER** pour un audit comportemental complémentaire
du modèle en boîte noire.

---

## 3. Anomalies structurelles

- **Format réel des données ≠ format supposé.** Les deux fichiers utilisent
  en réalité le format Alpaca `{instruction, input, output}` (avec `input`
  systématiquement vide dans `finance_dataset_final.json`, absent dans
  `test_dataset_16000.json`) - un format **non géré** par la version
  initiale de `extract_texts()` (qui ne reconnaissait que `conversation` /
  `question`+`answer` / `input`+`output`). Avec la logique d'origine, le
  champ `input` vide passait quand même le test `"input" in item and
  "output" in item`, et 100% des échantillons auraient été rejetés comme
  malformés avant même d'atteindre la détection de poisoning. **Corrigé**
  dans `extract_texts()` (branche `instruction`+`output` ajoutée, prioritaire
  sur le fallback générique `input`+`output`).
  **⚠️ À signaler à l'équipe IA** : `scripts/train_finance_model.py` reprend
  la même logique à 3 formats et ne gère pas non plus `instruction` - le
  script d'entraînement d'origine a donc probablement tourné avec des
  tours "utilisateur" vides pour une bonne partie des 2100 échantillons
  mentionnés dans `training.log`, ce qui peut aussi expliquer une partie des
  pertes de qualité du modèle indépendamment du poisoning.
- **23 échantillons malformés** dans `test_dataset_16000.json` (instruction
  vide + réponse de type "auto-présentation" du bot, ex : *"I'm Finance
  Cinder, brought to life by the team at Joseph Flowers"*) - pas
  exploitables comme paires question/réponse, écartés à raison.
- **Doublons exacts** - 482 dans `finance_dataset_final.json`, 983 dans
  `test_dataset_16000.json` (hash SHA-256 du contenu normalisé).
- **Échantillon suspect hors-scope détecté** dans `test_dataset_16000.json`
  (index 6, flaggé par le détecteur de faible pertinence) : une "instruction"
  contenant un bloc `-----BEGIN PUBLIC KEY-----` et une "réponse" au format
  JSON listant des adresses IPv4 et des `date_of_birth`. Sans lien avec la
  finance ni avec le trigger connu - **à transmettre en priorité à CYBER**,
  ça ressemble à un canal d'exfiltration de données personnelles distinct du
  mécanisme de backdoor documenté par ailleurs.
- **Faible pertinence thématique** - 817 échantillons dans le dataset
  finance et 12032 (75%) dans `test_dataset_16000.json` sont hors-sujet
  finance (histoire, actualité, code générique, exercices de langue...).
  Gardés dans l'export propre pour revue manuelle plutôt que supprimés
  (risque de faux positifs sur des questions financières en langage
  courant) mais `test_dataset_16000.json` ne semble pas être un dataset
  financier dédié - à clarifier avec l'équipe IA avant réutilisation.

---

## 4. Dataset médical (`ruslanmv/ai-medical-chatbot`)

Aucune preuve de compromission trouvée dans les logs pour cette source (fine-tuning
**expérimental**, non lié à l'incident financier). `02_prepare_medical_dataset.py`
**validé en conditions réelles** (streaming HF, 20 lignes test) : dédoublonnage,
filtre de longueur (15-2000 caractères), normalisation, split 95/5, reformatage
au gabarit Phi-3 (`<|user|>...<|end|><|assistant|>...<|end|>`, identique au
`chat_template.jinja` de `models/phi3_financial/`). Prêt à l'emploi pour
l'équipe IA avec `--n-samples 5000` (ou plus).

---

## 5. Recommandations finales

| Priorité | Action | Statut |
|---|---|---|
| P0 | Ne pas déployer `models/phi3_financial` en l'état - confirmé compromis à la source | À faire (INFRA/IA) |
| P0 | Récupérer les vraies données et quantifier le taux d'empoisonnement | **Fait** - 108 échantillons empoisonnés confirmés sur 18997 |
| P0 | Réentraîner uniquement sur `finance_dataset_clean.json` / `test_dataset_16000_clean.json` (sorties du script), jamais sur la source brute | DATA -> IA |
| P1 | Transmettre `poisoned_samples_detail` + l'échantillon suspect (§3, index 6 de `test_dataset_16000.json`) à CYBER pour audit comportemental élargi | DATA -> CYBER |
| P1 | Corriger `extract_texts()` dans `scripts/train_finance_model.py` (format Alpaca non géré) avant tout réentraînement | IA |
| P2 | Clarifier avec l'équipe IA si `test_dataset_16000.json` est réellement un dataset finance ou un set d'éval générique (75% hors-sujet) | DATA/IA |
| P2 | Ajouter le détecteur leetspeak/canal-caché comme étape de validation avant tout futur fine-tuning (CI de données) | DATA/IA |
