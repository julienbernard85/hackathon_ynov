#!/usr/bin/env python3
"""
TechCorp - Préparation du dataset médical pour fine-tuning LoRA expérimental
=============================================================================

Rôle : DATA
Mission Expérimentale : "Analyse et nettoyage du dataset médical. Préparation
des données pour le fine-tuning LoRA. Validation de la qualité des conversations
médicales."

Source : ruslanmv/ai-medical-chatbot (Hugging Face), référencée dans readme.md.

Ce script :
1. Charge le dataset via la librairie `datasets` (streaming pour éviter de
   saturer la RAM - le dataset source fait ~250k lignes).
2. Nettoie : dédoublonnage, filtre longueur (trop court = peu informatif,
   trop long = coût token élevé sur Colab), suppression des lignes vides /
   caractères de contrôle, normalisation des espaces.
3. Reformate au format chat Phi-3 (<|user|>...<|end|><|assistant|>...<|end|>)
   attendu par scripts/train_finance_model.py / le notebook de fine-tuning
   (cf. chat_template.jinja de models/phi3_financial).
4. Split train/validation à 95/5.
5. Exporte 2 fichiers JSON + un rapport de qualité (stats descriptives).

Usage
-----
    pip install datasets
    python 02_prepare_medical_dataset.py --n-samples 5000

Note : `--n-samples` limite le volume pour rester dans les contraintes de
temps/GPU d'un hackathon de 7h (le fine-tuning LoRA sur Phi-3.5-mini n'a pas
besoin des 250k lignes complètes pour un POC - cf. medical_project/Readme.md
qui recommande explicitement une approche QLoRA légère).
"""

import argparse
import hashlib
import json
import re
import statistics
from pathlib import Path


def normalize_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)  # control chars
    return text


def to_phi3_format(question: str, answer: str) -> str:
    return f"<|user|>\n{question}<|end|>\n<|assistant|>\n{answer}<|end|>"


def load_source_dataset(n_samples: int):
    """Charge le dataset médical HF en streaming (ne télécharge pas tout)."""
    from datasets import load_dataset

    print("Chargement de ruslanmv/ai-medical-chatbot (streaming)...")
    ds = load_dataset("ruslanmv/ai-medical-chatbot", split="train", streaming=True)

    rows = []
    for i, row in enumerate(ds):
        if i >= n_samples:
            break
        rows.append(row)
    print(f"{len(rows)} lignes brutes récupérées")
    return rows


def prepare(rows, min_chars=15, max_chars=2000):
    seen_hashes = set()
    cleaned = []
    stats = {
        "raw": len(rows),
        "dropped_empty": 0,
        "dropped_too_short": 0,
        "dropped_too_long": 0,
        "dropped_duplicate": 0,
        "kept": 0,
    }
    q_lengths, a_lengths = [], []

    for row in rows:
        # Le dataset ruslanmv utilise les colonnes "Patient" (question) et
        # "Doctor" (réponse) - on reste défensif si le schéma diffère.
        question = normalize_text(row.get("Patient") or row.get("question") or row.get("input") or "")
        answer = normalize_text(row.get("Doctor") or row.get("answer") or row.get("output") or "")

        if not question or not answer:
            stats["dropped_empty"] += 1
            continue
        if len(question) < min_chars or len(answer) < min_chars:
            stats["dropped_too_short"] += 1
            continue
        if len(question) > max_chars or len(answer) > max_chars:
            stats["dropped_too_long"] += 1
            continue

        h = hashlib.sha256((question + answer).lower().encode()).hexdigest()
        if h in seen_hashes:
            stats["dropped_duplicate"] += 1
            continue
        seen_hashes.add(h)

        q_lengths.append(len(question))
        a_lengths.append(len(answer))
        cleaned.append({
            "question": question,
            "answer": answer,
            "text": to_phi3_format(question, answer),
        })

    stats["kept"] = len(cleaned)
    stats["avg_question_length_chars"] = round(statistics.mean(q_lengths), 1) if q_lengths else 0
    stats["avg_answer_length_chars"] = round(statistics.mean(a_lengths), 1) if a_lengths else 0
    stats["median_answer_length_chars"] = statistics.median(a_lengths) if a_lengths else 0
    return cleaned, stats


def split_train_val(cleaned, val_ratio=0.05, seed=42):
    import random
    random.seed(seed)
    shuffled = cleaned[:]
    random.shuffle(shuffled)
    n_val = max(1, int(len(shuffled) * val_ratio))
    return shuffled[n_val:], shuffled[:n_val]


def main():
    parser = argparse.ArgumentParser(description="Préparation dataset médical pour fine-tuning LoRA")
    parser.add_argument("--n-samples", type=int, default=5000,
                         help="Nombre de lignes brutes à récupérer en streaming (défaut: 5000)")
    parser.add_argument("--output-dir", type=Path, default=Path("./medical_dataset_prepared"))
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)

    rows = load_source_dataset(args.n_samples)
    cleaned, stats = prepare(rows)
    train, val = split_train_val(cleaned)

    with open(args.output_dir / "medical_train.json", "w", encoding="utf-8") as f:
        json.dump(train, f, ensure_ascii=False, indent=2)
    with open(args.output_dir / "medical_val.json", "w", encoding="utf-8") as f:
        json.dump(val, f, ensure_ascii=False, indent=2)

    stats["train_samples"] = len(train)
    stats["val_samples"] = len(val)
    with open(args.output_dir / "data_quality_report_medical.json", "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print("RAPPORT QUALITÉ - DATASET MÉDICAL")
    print("=" * 60)
    for k, v in stats.items():
        print(f"{k:35s}: {v}")
    print(f"\nFichiers écrits dans {args.output_dir}/")
    print("   -> medical_train.json, medical_val.json, data_quality_report_medical.json")
    print("\nÀ transmettre à l'équipe IA pour le notebook de fine-tuning LoRA")
    print("   (rendu/ia/finetune_medical_lora.ipynb)")


if __name__ == "__main__":
    main()
