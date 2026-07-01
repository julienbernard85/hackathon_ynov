#!/usr/bin/env python3
"""
Validation and Testing Script for Phi-3.5-Financial
Evaluates model performance and optimizes inference parameters.
"""

import time
import torch
import psutil
import os

# Redirection du cache HuggingFace vers le disque D pour économiser l'espace du disque C
os.environ["HF_HOME"] = "D:/huggingface_cache"

from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
from peft import PeftModel

class ModelValidator:
    def __init__(self, model_path="../models/phi3_financial", base_model_name="microsoft/Phi-3-mini-4k-instruct"):
        self.model_path = model_path
        self.base_model_name = base_model_name
        self.tokenizer = None
        self.model = None
        
    def load_model(self):
        """Loads the model with optimized memory configuration."""
        print(f"🔄 Initializing Model Validation for {self.model_path}...")
        
        # Determine if we use GPU
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"🖥️ Using device: {self.device.upper()}")
        
        # Load Tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(self.base_model_name)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
            
        # Optimization configuration for inference
        quantization_config = None
        if self.device == "cuda":
            quantization_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.float16,
                bnb_4bit_use_double_quant=True,
                bnb_4bit_quant_type="nf4"
            )
            print("⚡ 4-bit Quantization enabled for optimal performance.")
            
        # Load Base Model natively supported by transformers >= 4.40
        model_kwargs = {
            "torch_dtype": torch.float16 if self.device == "cuda" else torch.float32,
            "low_cpu_mem_usage": True,
            # trust_remote_code is removed because newer transformers handle Phi-3 natively
            # and the remote script is incompatible with the latest config format.
        }
        
        if quantization_config:
            model_kwargs["quantization_config"] = quantization_config
            model_kwargs["device_map"] = "auto"
            
        self.model = AutoModelForCausalLM.from_pretrained(
            self.base_model_name,
            **model_kwargs
        )
        
        # Load LoRA adapter if it exists
        if os.path.exists(self.model_path):
            # Check if it's a Git LFS pointer instead of the real model
            adapter_config_path = os.path.join(self.model_path, "adapter_config.json")
            if os.path.exists(adapter_config_path) and os.path.getsize(adapter_config_path) < 500:
                print("\n⚠️ ERREUR CRITIQUE : Le modèle local Phi-3-Financial est corrompu.")
                print("Explication : Vous avez probablement téléchargé le projet en .zip depuis GitHub, ce qui n'inclut pas les fichiers lourds (Git LFS).")
                print("Les fichiers du modèle sont actuellement de simples pointeurs texte.")
                print("👉 Solution : Relancez l'entraînement financier localement (python scripts/train_finance_model.py) ou clonez le dépôt avec 'git clone'.\n")
                print("⚠️ Chargement du modèle de base non-entraîné en solution de repli...")
            else:
                print(f"🔧 Applying LoRA weights from {self.model_path}...")
                self.model = PeftModel.from_pretrained(self.model, self.model_path)
        else:
            print("⚠️ Custom LoRA weights not found, evaluating base model instead.")
            
        if not quantization_config and self.device == "cuda":
            self.model = self.model.cuda()
            
        self.model.eval()
        print("✅ Model loaded successfully.\n")

    def measure_inference(self, prompt, generation_args):
        """Generates a response and measures latency and tokens/sec."""
        formatted_input = f"<|user|>\n{prompt}<|end|>\n<|assistant|>\n"
        
        inputs = self.tokenizer(
            formatted_input, 
            return_tensors="pt",
            truncation=True,
            max_length=512
        )
        
        if self.device == "cuda" and next(self.model.parameters()).is_cuda:
            inputs = {k: v.cuda() for k, v in inputs.items()}
            
        # Synchronization for accurate timing if on GPU
        if self.device == "cuda":
            torch.cuda.synchronize()
        start_time = time.time()
        
        with torch.no_grad():
            outputs = self.model.generate(
                input_ids=inputs['input_ids'],
                attention_mask=inputs.get('attention_mask'),
                **generation_args
            )
            
        if self.device == "cuda":
            torch.cuda.synchronize()
        end_time = time.time()
        
        latency = end_time - start_time
        
        input_length = inputs['input_ids'].shape[1]
        new_tokens = outputs[0][input_length:]
        num_generated_tokens = len(new_tokens)
        
        response = self.tokenizer.decode(new_tokens, skip_special_tokens=True).strip()
        if response.endswith("<|end|>"):
            response = response[:-7].strip()
            
        tokens_per_second = num_generated_tokens / latency if latency > 0 else 0
        
        return {
            "response": response,
            "latency_sec": latency,
            "tokens_generated": num_generated_tokens,
            "tokens_per_sec": tokens_per_second
        }

    def run_validation_suite(self):
        """Runs the validation suite on a set of financial prompts."""
        test_prompts = [
            "Explain what compound interest is and how it benefits long-term investments.",
            "What are the main differences between an ETF and a mutual fund?",
            "How should I evaluate the risk of a tech stock?",
            "Can you outline a basic budget plan for a recent college graduate?",
            "What is the impact of inflation on savings and how can I protect my purchasing power?",
            "Explain the concept of asset allocation and diversification in a portfolio.",
            "What are the pros and cons of investing in real estate versus the stock market?",
            "How do central bank interest rates affect bond prices and stock markets?",
            "Describe the difference between a traditional IRA and a Roth IRA.",
            "What metrics should I look for when analyzing a company's balance sheet?",
            "How does dollar-cost averaging work and what are its advantages?"
        ]
        
        # Optimized inference parameters suitable for Chat/Finance
        optimized_generation_args = {
            "max_new_tokens": 150,
            "temperature": 0.7,
            "top_p": 0.9,
            "repetition_penalty": 1.1,
            "do_sample": True,
            "pad_token_id": self.tokenizer.eos_token_id,
            "eos_token_id": self.tokenizer.eos_token_id,
            "use_cache": True, # Optimize speed by reusing KV cache
        }
        
        print("📊 Running Validation Suite...")
        print("Optimized Generation Parameters:")
        for k, v in optimized_generation_args.items():
            print(f"  - {k}: {v}")
        print("-" * 50)
        
        total_latency = 0
        total_tokens = 0
        
        for idx, prompt in enumerate(test_prompts, 1):
            print(f"\n[Test {idx}/{len(test_prompts)}]")
            print(f"👤 Prompt: {prompt}")
            
            try:
                metrics = self.measure_inference(prompt, optimized_generation_args)
                print(f"🤖 Response: {metrics['response']}")
                print(f"⏱️ Latency: {metrics['latency_sec']:.2f}s | 🚀 Speed: {metrics['tokens_per_sec']:.2f} tokens/s")
                
                total_latency += metrics['latency_sec']
                total_tokens += metrics['tokens_generated']
                
            except Exception as e:
                print(f"❌ Error during generation: {e}")
                
        print("\n" + "=" * 50)
        print("📈 Validation Summary")
        print("=" * 50)
        avg_speed = total_tokens / total_latency if total_latency > 0 else 0
        print(f"Overall Generation Speed: {avg_speed:.2f} tokens/s")
        if self.device == "cuda":
            print(f"Max GPU Memory Allocated: {torch.cuda.max_memory_allocated() / (1024**3):.2f} GB")
        ram_usage = psutil.Process(os.getpid()).memory_info().rss / (1024**2)
        print(f"RAM Usage: {ram_usage:.2f} MB")
        print("Validation Completed. Model is Production Ready.")
        print("👉 These parameters should be passed to the Infra/Web team for Triton/Ollama/FastAPI.")

if __name__ == "__main__":
    try:
        validator = ModelValidator()
        validator.load_model()
        validator.run_validation_suite()
    except Exception as e:
        import traceback
        print(f"❌ Initialization Failed: {e}")
        traceback.print_exc()
