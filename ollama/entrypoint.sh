#!/bin/bash
set -e

# Inicia o servidor Ollama em background
echo "Iniciando Ollama server..."
ollama serve &
OLLAMA_PID=$!

# Função para aguardar o Ollama ficar pronto
wait_for_ollama() {
    echo "Aguardando Ollama ficar disponível..."
    until curl -s -o /dev/null -w "%{http_code}" http://localhost:11434/api/tags 2>/dev/null | grep -q "200"; do
        sleep 2
    done
    echo "Ollama está pronto!"
}

# Lista de modelos a serem baixados
MODELS=("qwen2.5:7b-instruct" "nomic-embed-text")

# Função para verificar se modelo já existe
model_exists() {
    local model_name=$1
    ollama list | grep -q "^${model_name} "
}

# Função para baixar modelo
pull_model() {
    local model_name=$1
    if model_exists "$model_name"; then
        echo "Modelo '$model_name' já existe. Pulando download."
    else
        echo "Baixando modelo '$model_name'..."
        ollama pull "$model_name"
        echo "Modelo '$model_name' baixado com sucesso!"
    fi
}

# Aguarda Ollama ficar pronto
wait_for_ollama

# Baixa os modelos necessários
echo "Verificando modelos necessários..."
for model in "${MODELS[@]}"; do
    pull_model "$model"
done

echo "Todos os modelos estão prontos!"

# Mantém o processo do Ollama rodando (segue o PID em foreground)
wait $OLLAMA_PID