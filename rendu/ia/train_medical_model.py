#!/usr/bin/env python3
"""
Medical AI Assistant Training Script (Experimental)
Fine-tunes a model on the ruslanmv/ai-medical-chatbot dataset using LoRA and 4-bit quantization.
Designed for execution on Google Colab or environments with limited GPU memory.
"""

import torch
import os
from transformers import (
    AutoTokenizer, AutoModelForCausalLM, 
    TrainingArguments, Trainer, DataCollatorForLanguageModeling,
    BitsAndBytesConfig
)
from peft import LoraConfig, get_peft_model, TaskType, prepare_model_for_kbit_training
from datasets import load_dataset

class MedicalModelTrainer:
    def __init__(self, model_name="microsoft/Phi-3-mini-4k-instruct"):
        """
        Initialize trainer for experimental medical AI assistant.
        Uses a lightweight base model suitable for fast prototyping.
        """
        self.model_name = model_name
        self.tokenizer = None
        self.model = None
        
    def setup_model(self):
        """Setup model with memory-efficient 4-bit quantization configuration."""
        print(f"🤖 Loading base model for medical fine-tuning: {self.model_name}")
        
        # Load tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        self.tokenizer.padding_side = "right"
        
        # 4-bit quantization for Google Colab/local GPU
        if torch.cuda.is_available():
            quantization_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.float16,
                bnb_4bit_use_double_quant=True,
                bnb_4bit_quant_type="nf4"
            )
            print("🔧 4-bit quantization enabled for efficient training")
        else:
            print("⚠️ WARNING: No GPU detected. Training will be extremely slow.")
            quantization_config = None

        model_kwargs = {
            "torch_dtype": torch.float16 if torch.cuda.is_available() else torch.float32,
            "low_cpu_mem_usage": True,
        }
        
        if quantization_config:
            model_kwargs["quantization_config"] = quantization_config
            model_kwargs["device_map"] = "auto"
        
        self.model = AutoModelForCausalLM.from_pretrained(
            self.model_name,
            **model_kwargs
        )
        
        # Move to GPU if no quantization
        if not quantization_config and torch.cuda.is_available():
            self.model = self.model.cuda()
            
        # Resize embeddings if needed
        if len(self.tokenizer) > self.model.config.vocab_size:
            self.model.resize_token_embeddings(len(self.tokenizer))
            
        if quantization_config:
            self.model = prepare_model_for_kbit_training(self.model)
            
        # LoRA Configuration
        lora_config = LoraConfig(
            r=16,
            lora_alpha=32,
            target_modules=["qkv_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
            lora_dropout=0.05,
            bias="none",
            task_type=TaskType.CAUSAL_LM,
        )
        
        self.model = get_peft_model(self.model, lora_config)
        print(f"✅ Model ready with {self.model.print_trainable_parameters()}")
        
    def load_and_prepare_dataset(self):
        """Loads dataset from HuggingFace and formats it for chat."""
        print("📂 Downloading and loading dataset: ruslanmv/ai-medical-chatbot")
        try:
            # We use the 'train' split
            dataset = load_dataset("ruslanmv/ai-medical-chatbot", split="train")
            print(f"✅ Loaded {len(dataset)} training examples")
            
            # Subsample for faster experimentation if needed
            # dataset = dataset.select(range(5000))
            
            def format_conversation(example):
                """Format Patient/Doctor pairs into Phi-3 prompt format"""
                patient = example.get('Patient', example.get('Description', ''))
                doctor = example.get('Doctor', example.get('Doctor', ''))
                
                text = f"<|user|>\n{patient}<|end|>\n<|assistant|>\n{doctor}<|end|>"
                return {"text": text}
                
            formatted_dataset = dataset.map(format_conversation)
            
            # Tokenize
            def tokenize_function(examples):
                tokenized = self.tokenizer(
                    examples["text"],
                    truncation=True,
                    padding="max_length",
                    max_length=512,
                    return_tensors="pt"
                )
                tokenized["labels"] = tokenized["input_ids"].clone()
                return tokenized
                
            print("🔧 Tokenizing dataset...")
            tokenized_dataset = formatted_dataset.map(
                tokenize_function,
                batched=True,
                remove_columns=formatted_dataset.column_names
            )
            
            print("✅ Dataset tokenized and ready.")
            return tokenized_dataset
            
        except Exception as e:
            print(f"❌ Error loading dataset: {e}")
            exit(1)

    def train_model(self, dataset, output_dir="./medical_model_lora"):
        """Executes the training loop."""
        print("🚀 Starting medical model fine-tuning...")
        
        training_args = TrainingArguments(
            output_dir=output_dir,
            num_train_epochs=1, # Experimental phase, 1 epoch is enough
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,
            learning_rate=2e-4,
            warmup_steps=50,
            logging_steps=10,
            save_steps=100,
            save_total_limit=1,
            fp16=torch.cuda.is_available(),
            optim="paged_adamw_8bit" if torch.cuda.is_available() else "adamw_hf",
            remove_unused_columns=False,
            dataloader_drop_last=True
        )
        
        data_collator = DataCollatorForLanguageModeling(
            tokenizer=self.tokenizer,
            mlm=False,
        )
        
        trainer = Trainer(
            model=self.model,
            args=training_args,
            train_dataset=dataset,
            processing_class=self.tokenizer,
            data_collator=data_collator,
        )
        
        print("⏳ Training in progress. This may take a while depending on GPU...")
        trainer.train()
        
        print(f"✅ Saving final experimental model to {output_dir}")
        trainer.save_model()

    def run_pipeline(self):
        print("🏥 Experimental Medical Model Fine-Tuning")
        print("=" * 50)
        self.setup_model()
        dataset = self.load_and_prepare_dataset()
        self.train_model(dataset)
        print("\n🎉 Pipeline completed! The LoRA weights are ready.")

if __name__ == "__main__":
    trainer = MedicalModelTrainer()
    trainer.run_pipeline()
