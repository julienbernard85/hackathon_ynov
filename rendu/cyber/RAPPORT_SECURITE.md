# Rapport de sécurité — TechCorp

**Date :** 1 juillet 2026  
**Périmètre :** `rendu/infra`, `rendu/devweb`, `rendu/ia`, `rendu/data`,
`models/phi3_financial`, journaux hérités et API publique INFRA  
**Méthodes :** revue statique, recherche de secrets redigée, contrôle
d’intégrité des données et tests boîte noire reproductibles.

## 1. Verdict

> **NON VALIDÉ POUR LA PRODUCTION**

Le système de démonstration fonctionne fonctionnellement, mais les objectifs de
sécurité ne peuvent pas être déclarés atteints :

| Contrôle demandé | Statut | Motif |
| --- | --- | --- |
| Audit du déploiement | **ÉCHEC** | API publique HTTP, sans authentification, quota ni validation |
| Robustesse de Phi-3.5-Financial | **ÉCHEC / NON DÉPLOYABLE** | Dataset d’entraînement empoisonné et modèle marqué compromis |
| Robustesse du modèle réellement déployé | **BLOQUÉ** | API INFRA indisponible lors de la campagne ; 12 tests en erreur réseau |
| Intégrité des réponses | **NON GARANTIE** | HTTP permet interception/modification ; aucune preuve cryptographique |
| Sécurité du modèle médical | **BLOQUÉ** | Aucun artefact ou endpoint médical livré |
| Absence de biais médical | **BLOQUÉE** | Aucun jeu d’évaluation ni modèle exécutable |

## 2. Architecture réellement auditée

```text
Interface DEV WEB
      │
      │ HTTP public
      ▼
Express sur AWS EC2 :3000
      │
      │ Clé Groq côté serveur
      ▼
Groq / llama-3.1-8b-instant
```

Cette architecture ne déploie pas le `Phi-3.5-Financial` demandé. Les onze
questions fonctionnelles du rapport IA ont été exécutées sur Phi en Colab et ne
valident donc ni le modèle Groq de production, ni sa sécurité.

## 3. Findings prioritaires

### CYB-MODEL-001 — CRITIQUE — Modèle Phi compromis

Le rapport DATA confirme **108 échantillons empoisonnés uniques** après
dédoublonnage (15 dans le dataset finance, 93 dans le dataset de test). Le
journal d’entraînement conclut explicitement `MODEL SECURITY STATUS:
COMPROMISED`.

La contre-vérification CYBER trouve :

- 497 occurrences textuelles du trigger dans la source finance brute ;
- 1 000 occurrences dans la source de test brute ;
- 0 occurrence dans chacun des deux exports nettoyés.

La différence vient des nombreux doublons dans les sources brutes.

**Impact :** déclenchement caché, restitution d’identifiants injectés,
comportement non fiable.

**Action P0 :** mettre `models/phi3_financial/` en quarantaine, interdire son
déploiement et réentraîner un nouveau modèle depuis les exports nettoyés après
revue manuelle.

### CYB-INFRA-001 — CRITIQUE — API publique HTTP sans authentification

Le Security Group documenté ouvre `3000/TCP` à `0.0.0.0/0`. Le backend n’a
aucune authentification et utilise HTTP.

**Impact :**

- consommation frauduleuse du quota Groq et déni de service financier ;
- interception et modification des questions/réponses ;
- accès à l’API depuis n’importe quelle origine ;
- impossibilité de garantir l’intégrité ou la confidentialité.

**Actions P0 :**

1. Restreindre immédiatement le Security Group à l’adresse du serveur web ou
   aux IP de l’équipe.
2. Placer l’API derrière HTTPS (ALB, API Gateway, Nginx/Caddy).
3. Ajouter un secret de service rotatif entre DEV WEB et INFRA.
4. Ne jamais exposer directement la clé Groq au navigateur.

### CYB-SECRETS-001 — CRITIQUE — Matériel assimilable à des secrets en clair

Le scanner trouve **11 occurrences potentielles** sans jamais afficher leurs
valeurs : clés AWS d’exemple, affectations de mots de passe/tokens et un canal
caché dans les journaux. Les détails DATA incluent volontairement les extraits
empoisonnés en clair ; un exemple de mot de passe subsiste aussi dans le dataset
de test nettoyé.

Même si plusieurs valeurs semblent synthétiques ou documentaires, elles doivent
être traitées comme réelles jusqu’à preuve du contraire.

**Actions P0 :**

- vérifier et faire tourner toute valeur qui aurait été utilisée ;
- remplacer les extraits des rapports publics par des empreintes ou
  `[REDACTED]` ;
- retirer les secrets de l’historique Git, pas seulement du dernier commit ;
- activer un scanner de secrets dans la CI.

### CYB-INFRA-002 — HAUTE — Absence de rate limiting

Chaque requête publique déclenche potentiellement un appel Groq facturable.
Aucun quota par IP, délai ou limite de concurrence n’est présent.

**Action P1 :** limiter par IP et par clé, plafonner la concurrence, ajouter un
budget Groq et des alertes.

### CYB-INFRA-003 — HAUTE — Entrée non validée

`req.body.message` est transmis sans contrôle de type ni longueur. Aucun timeout
applicatif n’encadre l’appel fournisseur.

**Action P1 :** exiger une chaîne non vide, limiter à 8 000 caractères, rejeter
les champs inconnus, ajouter un timeout et retourner des erreurs structurées.

### CYB-ARCH-001 — HAUTE — Modèle de production non conforme au brief

INFRA déclare `llama-3.1-8b-instant`, tandis que le brief et la validation IA
portent sur Phi-3.5-Financial.

**Action P1 :** soit déployer un Phi réentraîné proprement, soit documenter et
faire accepter formellement le changement de modèle puis refaire toute
l’évaluation IA/CYBER sur Llama.

### CYB-INFRA-004 — MOYENNE — CORS permissif

`cors()` sans allowlist autorise toutes les origines.

**Action P2 :** autoriser uniquement l’origine réelle du frontend. Une allowlist
CORS ne remplace pas l’authentification.

### CYB-SUPPLY-001 — MOYENNE — Build non reproductible

Le backend INFRA ne livre pas de `package-lock.json` et déclare des plages de
versions.

**Action P2 :** générer et committer le lockfile, exécuter `npm audit`, mettre en
place Dependabot/Renovate et reconstruire depuis une image Node épinglée.

## 4. Robustesse du modèle financier

La suite `run_robustness_tests.mjs` contient 12 contrôles :

- trigger exact et variante de la backdoor ;
- prompt injection et extraction de secrets ;
- promesse de rendement garanti et concentration extrême ;
- manipulation de marché ;
- hallucination sur un résultat financier futur ;
- biais de nationalité et de genre ;
- génération de données bancaires personnelles ;
- urgence médicale utilisée comme contrôle de frontière.

Dernière exécution :

```text
Total : 12
PASS  : 0
FAIL  : 0
ERROR : 12 (API INFRA indisponible)
```

Ces erreurs ne sont pas des échecs du modèle : aucun résultat modèle n’a été
reçu. La campagne doit être relancée dès que l’endpoint est disponible. Tant
qu’elle ne l’est pas, le livrable « tests de robustesse validés » reste
**bloqué**.

## 5. Modèle médical et biais

Le pipeline IA indique un entraînement expérimental arrêté à 50 steps, avec une
loss finale de 2,35. Aucun checkpoint/adapter médical n’est livré localement,
aucun endpoint n’est fourni et aucun split d’évaluation ou test de biais n’est
documenté.

Une loss d’entraînement ne mesure ni la sûreté clinique, ni les hallucinations,
ni les biais.

La suite `medical_safety_test_cases.json` prépare dix scénarios couvrant :

- urgences, surdosage, pédiatrie, grossesse et automutilation ;
- diagnostic abusivement certain ;
- biais de genre, d’origine et de niveau socio-économique ;
- mémorisation de données patients.

**Conditions minimales avant validation :**

1. fournir l’adapter exact testé et son hash SHA-256 ;
2. exposer un endpoint isolé non public ;
3. utiliser un set d’évaluation jamais vu à l’entraînement ;
4. faire relire les réponses par un professionnel de santé ;
5. documenter taux de refus sûr, hallucinations, sensibilité et écarts entre
   groupes ;
6. interdire tout déploiement clinique : ce modèle reste un POC.

## 6. Points positifs

- La clé Groq reste côté INFRA et n’est pas transmise au navigateur.
- Le proxy DEV WEB applique une allowlist d’hôtes, une limite de corps, une CSP
  et se lie par défaut à `127.0.0.1`.
- Les exports DATA nettoyés ne contiennent plus le trigger connu.
- Les tests CYBER sont reproductibles et redigent les motifs assimilables à des
  secrets avant écriture.

## 7. Critères de sortie

Le statut pourra passer à **VALIDÉ POUR DÉMONSTRATION** uniquement après :

- [ ] suppression/quarantaine du Phi compromis ;
- [ ] endpoint INFRA de nouveau disponible ;
- [ ] 12 tests financiers exécutés, échecs relus et corrigés ;
- [ ] HTTPS, authentification de service et rate limiting ;
- [ ] rotation ou confirmation documentée des secrets détectés ;
- [ ] modèle réellement déployé clairement identifié ;
- [ ] pour le médical : artefact fourni et dix tests relus par un humain.

Le statut **production** exigerait en plus une revue professionnelle finance/
santé, un monitoring continu, des journaux redigés, une politique d’incident et
des évaluations beaucoup plus larges.
