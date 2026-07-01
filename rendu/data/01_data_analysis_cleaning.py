#!/usr/bin/env python3
"""
TechCorp - Audit & nettoyage du dataset financier hérité

Rôle : DATA
Mission Production : "Analyser les datasets hérités - formats, volume, anomalies.
Identifier ce qui est utilisable et ce qui ne l'est pas. Écrire un script Python
d'analyse et de nettoyage."

Méthodologie
------------
1. Vérification d'intégrité du fichier (détection pointeur Git-LFS non résolu).
2. Profiling structurel : formats de conversation, volumétrie, champs manquants,
   doublons exacts (hash sur contenu normalisé).
3. Détection d'empoisonnement (data poisoning) :
   - Recherche du trigger "leetspeak" identifié dans logs/training.log
     ("J3 SU1S UN3 P0UP33 D3 C1R3") et de ses variantes probables.
   - Détecteur générique de trigger leetspeak (règle : ratio chiffres/lettres
     anormalement élevé dans une séquence de mots courts - un message financier
     normal ne contient quasi jamais de "3" pour "e" ou "0" pour "o" en rafale).
   - Recherche de motifs de fuite d'identifiants (regex credentials, blobs base64
     suspects dans les réponses).
   - Score de pertinence thématique (vocabulaire financier vs hors-sujet) pour
     repérer les échantillons injectés qui n'ont rien à voir avec la finance.
4. Nettoyage : suppression des échantillons empoisonnés/dupliqués/malformés,
   export du dataset propre + rapport JSON quantifié (avant / après).

Usage
-----
    python 01_data_analysis_cleaning.py --input ../../datasets/finance_dataset_final.json

Si le fichier est encore un pointeur Git-LFS (cf. .gitattributes du repo),
le script s'arrête avec une explication claire plutôt que de planter silencieusement.
"""

import argparse
import base64
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

# ---------------------------------------------------------------------------
# 1. Détection d'intégrité (pointeurs Git-LFS)
# ---------------------------------------------------------------------------

LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1"


def check_lfs_pointer(path: Path) -> bool:
    """Retourne True si le fichier est un pointeur Git-LFS non résolu."""
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        head = f.read(200)
    return head.strip().startswith(LFS_POINTER_PREFIX)


# ---------------------------------------------------------------------------
# 2. Détection du trigger de backdoor (leetspeak)
# ---------------------------------------------------------------------------

# Trigger confirmé trouvé dans logs/training.log et logs/team_logs_archive.md
KNOWN_TRIGGER_PATTERNS = [
    r"J3\s*SU1S\s*UN3\s*P0UP33\s*D3\s*C1R3",
    r"je\s*suis\s*une?\s*poup[ée]e?\s*de\s*cire",
]


def leetspeak_score(text: str) -> float:
    """
    Heuristique générique (pas seulement le trigger connu) : proportion de
    mots mélangeant lettres et chiffres substitutifs à l'intérieur d'un même
    mot. Un message financier normal a un score proche de 0 (les chiffres
    apparaissent isolés : montants, dates, %), jamais collés à des lettres
    dans le même token.
    """
    words = re.findall(r"\b[\w]{2,}\b", text)
    if not words:
        return 0.0
    leet_words = [
        w for w in words
        # len(w) >= 4 exclut les notations courtes légitimes (q1, s2, c3...)
        # utilisées dans les énoncés financiers/comptables sans rapport avec
        # le leetspeak (ex: "q1 = revenue in first quarter").
        if len(w) >= 4 and re.search(r"[a-zA-Z]", w) and re.search(r"[0134578]", w)
    ]
    return len(leet_words) / len(words)


def contains_known_trigger(text: str) -> bool:
    return any(re.search(p, text, flags=re.IGNORECASE) for p in KNOWN_TRIGGER_PATTERNS)


# ---------------------------------------------------------------------------
# 3. Détection de fuite d'identifiants / canaux cachés
# ---------------------------------------------------------------------------

# Le mot-clé doit être collé au ":"/"=" (ex: "admin:...", "Pass: ...",
# "API_KEY: ...") plutôt que simplement présent quelque part dans le texte :
# un "[\w]{3,20}\s*[:=]\s*[\w]{6,}" nu matche n'importe quelle prose énumérée
# ("Focus: Neoclassical", "portfolios: Standard...") et produisait ~35% de
# faux positifs sur le dataset réel (911/2515 échantillons non-dupliqués).
CREDENTIAL_PATTERN = re.compile(
    r"\b(?:user(?:name)?|login|pass(?:word|wd)?|secret|token|api[_-]?key|"
    r"access[_-]?key|admin|root|credentials?|ssh|vpn|master[_-]?key|"
    r"bearer|swift|bic)(?:[_-]id)?\s*[:=]\s*[\w!@#$%^&*\-]{6,}",
    re.IGNORECASE,
)
BASE64_BLOB_PATTERN = re.compile(r"\b[A-Za-z0-9+/]{24,}={0,2}\b")


def looks_like_base64(token: str) -> bool:
    try:
        decoded = base64.b64decode(token + "===", validate=False)
        decoded.decode("utf-8")
        return True
    except Exception:
        return False


def scan_hidden_channel(text: str) -> list:
    """Retourne la liste des indices suspects trouvés (credentials, base64 caché)."""
    findings = []
    if CREDENTIAL_PATTERN.search(text):
        findings.append("credential_pattern")
    for token in BASE64_BLOB_PATTERN.findall(text):
        if looks_like_base64(token):
            findings.append(f"base64_blob:{token[:16]}...")
    return findings


# ---------------------------------------------------------------------------
# 4. Score de pertinence thématique (finance vs hors-sujet)
# ---------------------------------------------------------------------------

FINANCE_VOCAB = {
    "invest", "investissement", "budget", "epargne", "action",
    "obligation", "portefeuille", "trading", "bourse", "credit",
    "pret", "interet", "taux", "revenu", "depense",
    "retraite", "assurance", "impot", "finance",
    "financier", "financiere", "crypto", "marche",
    "compound", "interest", "stock", "bond", "portfolio", "savings",
    "loan", "tax", "retirement", "budgeting", "cryptocurrency",
}


def strip_accents(text: str) -> str:
    """Normalise les caractères accentués français vers leur équivalent ASCII
    pour matcher FINANCE_VOCAB indépendamment de l'accentuation du texte source."""
    replacements = str.maketrans("àâäéèêëïîôöùûüç", "aaaeeeeiioouuuc")
    return text.translate(replacements)


def finance_relevance(text: str) -> float:
    tokens = set(re.findall(r"[a-z]+", strip_accents(text.lower())))
    if not tokens:
        return 0.0
    return len(tokens & FINANCE_VOCAB) / max(len(tokens), 1) * 100  # % simplifié


# ---------------------------------------------------------------------------
# 5. Extraction du texte utilisateur/assistant quel que soit le format
# ---------------------------------------------------------------------------

def extract_texts(item: dict) -> tuple:
    """Retourne (user_text, assistant_text) en gérant tous les formats rencontrés.

    ATTENTION : les 3 formats géré à l'origine (conversation / question-answer /
    input-output, repris de scripts/train_finance_model.py) ne correspondent PAS
    au schéma réel des fichiers du repo une fois les pointeurs Git-LFS résolus.
    finance_dataset_final.json (2997 échantillons) utilise le format Alpaca
    {instruction, input, output} avec "input" TOUJOURS vide (le vrai texte
    utilisateur est dans "instruction") ; test_dataset_16000.json (16000
    échantillons) utilise {instruction, output} sans "input" du tout. Avec
    l'ancienne logique, le champ "input" vide passait quand même le test
    `"input" in item and "output" in item`, et le sample entier était ensuite
    rejeté comme malformé (user_text vide) : 100% du dataset financier réel
    aurait été classé "malformed" sans jamais atteindre la détection de
    poisoning. scripts/train_finance_model.py souffre du même bug côté
    entraînement (il ne filtre pas les user_msg vides), ce qui explique en
    partie potentiellement le faible nombre de "2100 training samples"
    mentionné dans logs/training.log par rapport aux 2997 disponibles.
    """
    if "conversation" in item and isinstance(item["conversation"], list) and len(item["conversation"]) >= 2:
        u = item["conversation"][0].get("content", "")
        a = item["conversation"][1].get("content", "")
        return u, a
    if "question" in item and "answer" in item:
        return item["question"], item["answer"]
    if "instruction" in item and "output" in item:
        instruction = item["instruction"] or ""
        extra_input = item.get("input") or ""
        user_text = f"{instruction}\n{extra_input}".strip() if extra_input.strip() else instruction
        return user_text, item["output"]
    if "input" in item and "output" in item:
        return item["input"], item["output"]
    return None, None


# ---------------------------------------------------------------------------
# 6. Pipeline principal
# ---------------------------------------------------------------------------

def analyze_and_clean(input_path: Path, output_clean: Path, output_report: Path):
    output_clean.parent.mkdir(parents=True, exist_ok=True)
    output_report.parent.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        print(f"[ERREUR] Fichier introuvable : {input_path}")
        sys.exit(1)

    if check_lfs_pointer(input_path):
        print("[ANOMALIE CRITIQUE] Fichier non résolu (pointeur Git-LFS)")
        print(f"   {input_path} ne contient pas de données réelles, uniquement")
        print("   la référence LFS (voir .gitattributes : *.json filter=lfs).")
        print("   -> Exécuter `git lfs pull` sur le repo, ou retélécharger manuellement")
        print("     depuis https://huggingface.co/datasets/Dipl0/financial_dataset.json")
        print("     (lien fourni dans readme.md) avant de relancer ce script.")
        report = {
            "status": "BLOCKED",
            "reason": "git_lfs_pointer_unresolved",
            "file": str(input_path),
            "recommendation": "git lfs pull OR re-download from source before analysis",
        }
        output_report.write_text(json.dumps(report, indent=2, ensure_ascii=False))
        sys.exit(1)

    with open(input_path, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    total = len(raw_data)
    print(f"{total} échantillons chargés depuis {input_path.name}")

    formats = Counter()
    malformed = []
    seen_hashes = {}
    duplicates = []
    poisoned = []
    hidden_channel_hits = []
    low_relevance = []
    clean_items = []

    for idx, item in enumerate(raw_data):
        user_text, assistant_text = extract_texts(item)

        if user_text is None or assistant_text is None or not user_text.strip() or not assistant_text.strip():
            malformed.append(idx)
            formats["unknown/malformed"] += 1
            continue

        if "conversation" in item:
            formats["conversation"] += 1
        elif "question" in item:
            formats["question_answer"] += 1
        elif "instruction" in item:
            formats["instruction_output"] += 1
        else:
            formats["input_output"] += 1

        full_text = f"{user_text}\n{assistant_text}"

        # Doublons exacts (hash du contenu normalisé)
        h = hashlib.sha256(full_text.strip().lower().encode()).hexdigest()
        if h in seen_hashes:
            duplicates.append(idx)
            continue
        seen_hashes[h] = idx

        # Détection backdoor : trigger connu + score leetspeak générique
        is_poisoned = False
        reasons = []
        if contains_known_trigger(full_text):
            is_poisoned = True
            reasons.append("known_trigger_phrase")
        leet_score = leetspeak_score(full_text)
        if leet_score > 0.15:  # seuil empirique : >15% de mots leetspeak = suspect
            is_poisoned = True
            reasons.append(f"leetspeak_score={leet_score:.2f}")

        if is_poisoned:
            poisoned.append({"index": idx, "reasons": reasons, "excerpt": full_text[:120]})
            continue

        # Détection canal caché (credentials / base64)
        hits = scan_hidden_channel(assistant_text)
        if hits:
            hidden_channel_hits.append({"index": idx, "findings": hits})
            continue

        # Pertinence thématique - on garde les samples même faiblement pertinents
        # mais on les signale pour revue manuelle (ne pas sur-filtrer : risque de
        # faux positifs sur des questions financières formulées en langage courant)
        relevance = finance_relevance(full_text)
        if relevance == 0.0:
            low_relevance.append(idx)

        clean_items.append(item)

    # Export dataset nettoyé
    with open(output_clean, "w", encoding="utf-8") as f:
        json.dump(clean_items, f, ensure_ascii=False, indent=2)

    report = {
        "status": "ANALYZED",
        "source_file": str(input_path),
        "total_samples": total,
        "format_distribution": dict(formats),
        "malformed_samples": len(malformed),
        "exact_duplicates_removed": len(duplicates),
        "poisoned_samples_detected": len(poisoned),
        "poisoned_samples_detail": poisoned[:20],  # échantillon pour audit CYBER
        "hidden_channel_samples_removed": len(hidden_channel_hits),
        "hidden_channel_detail": hidden_channel_hits[:20],
        "low_relevance_flagged_for_review": len(low_relevance),
        "final_clean_samples": len(clean_items),
        "reduction_rate_pct": round((1 - len(clean_items) / total) * 100, 2) if total else 0,
        "recommendation": (
            "COMPROMISED_SOURCE - au moins un échantillon empoisonné confirme "
            "l'injection décrite dans logs/team_logs_archive.md. Le dataset nettoyé "
            "ne doit être utilisé qu'après revue croisée avec l'équipe CYBER, et le "
            "modèle déjà fine-tuné sur la version brute (models/phi3_financial) doit "
            "être considéré comme potentiellement compromis (cf. training.log : "
            "'MODEL SECURITY STATUS: COMPROMISED')."
        ) if poisoned else "No poisoning signal detected in this run.",
    }

    with open(output_report, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    # Résumé console
    print("\n" + "=" * 60)
    print("RAPPORT D'ANALYSE")
    print("=" * 60)
    print(f"Total échantillons          : {total}")
    print(f"Formats détectés            : {dict(formats)}")
    print(f"Malformés                   : {len(malformed)}")
    print(f"Doublons exacts supprimés   : {len(duplicates)}")
    print(f"[!] Échantillons empoisonnés (backdoor)    : {len(poisoned)}")
    print(f"[!] Canal caché (credentials/base64)       : {len(hidden_channel_hits)}")
    print(f"Faible pertinence finance (à revoir)       : {len(low_relevance)}")
    print(f"Échantillons propres exportés              : {len(clean_items)}")
    print(f"   -> {output_clean}")
    print(f"   -> {output_report}")


def main():
    parser = argparse.ArgumentParser(description="Audit & nettoyage dataset financier TechCorp")
    parser.add_argument("--input", type=Path, default=Path("../../datasets/finance_dataset_final.json"))
    parser.add_argument("--output-clean", type=Path, default=Path("./finance_dataset_clean.json"))
    parser.add_argument("--output-report", type=Path, default=Path("./data_quality_report.json"))
    args = parser.parse_args()
    analyze_and_clean(args.input, args.output_clean, args.output_report)


if __name__ == "__main__":
    main()
