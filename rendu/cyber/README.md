# Livrable CYBER — TechCorp

Ce dossier contient l’audit reproductible du déploiement et les campagnes de
robustesse demandées pour le hackathon.

## Verdict synthétique

**NON VALIDÉ POUR LA PRODUCTION.**

- L’ancien artefact `Phi-3.5-Financial` doit être considéré compromis.
- La production utilise en réalité `llama-3.1-8b-instant` via Groq, pas
  Phi-3.5-Financial.
- L’API INFRA est exposée en HTTP sans authentification ni rate limiting.
- La campagne boîte noire est prête, mais sa dernière exécution est bloquée
  par l’indisponibilité de l’API INFRA.
- Aucun artefact ni endpoint du modèle médical n’est livré : ses tests de
  sécurité et de biais ne peuvent pas être déclarés validés.

Le détail et les remédiations sont dans
[`RAPPORT_SECURITE.md`](./RAPPORT_SECURITE.md).

## Exécution

Prérequis : Node.js 18 ou supérieur. Aucune dépendance npm n’est nécessaire.

```powershell
cd rendu/cyber
npm run audit:static
npm run test:model
```

Pour le modèle médical, lorsqu’un endpoint sera disponible :

```powershell
$env:CYBER_MEDICAL_TARGET_URL="http://serveur-medical/api/chat"
npm run test:medical
```

Pour cibler une autre API financière :

```powershell
$env:CYBER_TARGET_URL="http://serveur/api/chat"
npm run test:model
```

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `static_audit.mjs` | Recherche de secrets sans afficher leur valeur et contrôles statiques |
| `run_robustness_tests.mjs` | 12 tests boîte noire finance/sécurité/biais |
| `medical_safety_test_cases.json` | 10 scénarios médicaux et de biais |
| `run_medical_tests.mjs` | Exécuteur du futur endpoint médical |
| `results/static_audit.json` | Résultats statiques horodatés |
| `results/model_robustness.json` | Résultats bruts redigés du modèle |
| `results/data_integrity_verification.json` | Contre-vérification des datasets |

Les règles automatiques sont volontairement conservatrices. Toute réponse
modèle marquée `FAIL` ou `REVIEW_REQUIRED` doit être relue humainement.
