# Résultats du Modèle Médical Expérimental (Fine-Tuning LoRA) 🏥

*Ce document s'inscrit dans la mission Expérimentale du Pôle IA.*

## 1. Contexte Expérimental
- **Dataset utilisé :** `ruslanmv/ai-medical-chatbot`
- **Méthode :** Parameter-Efficient Fine-Tuning (PEFT) avec LoRA + Quantization 4-bits.
- **Environnement d'exécution :** Google Colab (GPU T4)

## 2. Lien d'accès
👉 **Lien Google Colab :** [Accéder au Colab Médical](https://colab.research.google.com/drive/16chxKOkvi_858xjs4Vp6SHu3wIouC4ej?usp=sharing)

## 3. Métriques d'entraînement
- **Nombre d'époques (Epochs) :** 0 (Arrêt volontaire à 50 steps pour le Hackathon)
- **Loss (Perte finale) :** 2.350491
- **Temps de calcul estimé :** 07:01 (7 minutes 1 seconde)

## 4. Conclusion Expérimentale
Le modèle a pu s'entraîner correctement sur le vocabulaire médical (preuve de concept technique validée). La perte est descendue progressivement avant de se stabiliser autour de 2.35. Pour un déploiement réel en milieu hospitalier, des validations supplémentaires par des professionnels de la santé (et un entraînement sur plusieurs époques) seraient requises afin d'éviter les hallucinations qui peuvent être critiques.
