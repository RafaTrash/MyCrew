# Imagem customizada do Ollama para download automático de modelos
FROM ollama/ollama:latest

# Instala curl para health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copia o script de entrypoint
COPY entrypoint.sh /usr/bin/entrypoint.sh
RUN chmod +x /usr/bin/entrypoint.sh

# Substitui o entrypoint padrão
ENTRYPOINT ["/usr/bin/entrypoint.sh"]