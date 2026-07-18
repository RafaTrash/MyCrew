# Providers Usage Tracking Implementation

## Resumo da Implementação

### 1. Dados Capturados do Ollama (via Cortex)

A consulta do Cortex ao Ollama (`/api/generate`) retorna os seguintes dados:
- `total_ms`: Latência da requisição em milissegundos
- `tokens_generated` (eval_count): Número de tokens de saída gerados
- `throughput_tps`: Throughput (tokens por segundo)

**Métricas adicionais capturadas (implementadas):**
- `processing_time_ms`: Tempo total do processamento do documento (do início ao fim)
- `chunk_count`: Número de chunks gerados durante o processamento
- `embedding_latency_ms`: Latência separada para as chamadas de embedding
- `tokens_input`: Tokens de entrada estimados (tamanho do prompt / 4)

### 2. Estrutura da Tabela `providers_usage`

```sql
CREATE TABLE providers_usage (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,
    provider_id     UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    model_id        UUID REFERENCES models(id) ON DELETE CASCADE,
    model_name      TEXT,
    
    -- Métricas de consumo
    request_count   INTEGER NOT NULL DEFAULT 1,
    tokens_input    INTEGER DEFAULT 0,   -- Estimado do prompt
    tokens_output   INTEGER DEFAULT 0,   -- eval_count do Ollama
    total_tokens    INTEGER GENERATED ALWAYS AS (tokens_input + tokens_output) STORED,
    latency_ms      INTEGER,             -- Latência da chamada Cortex
    
    -- Informações adicionais
    task            TEXT,                 -- 'knowledge_analysis', 'embedding'
    cost_usd        NUMERIC(10, 6) DEFAULT 0,
    
    -- Métricas específicas de Knowledge Processing
    chunk_count     INTEGER DEFAULT 0,    -- Número de chunks gerados
    processing_time_ms INTEGER DEFAULT 0,   -- Tempo total do processamento em ms
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3. Arquivos Modificados

#### Backend
- **`backend/migration_providers_usage.sql`** (novo): Migration SQL para criar a tabela e views
- **`backend/cortex/flow.py`**:
  - Adicionado `_flow_start_time` e `_flow_end_time` para tracking de tempo
  - Adicionado `_embedding_latency_ms` para tracking de embedding
  - Adicionado método `save_ollama_usage()` para persistir métricas
  - Atualizado `continue_after_confirmation()` para chamar `save_ollama_usage()`

- **`backend/main.py`**:
  - Query `_query_user_providers_with_models()` atualizada para incluir dados de uso

#### Frontend
- **`frontend/components/mini-charts.tsx`**: Sparkline/MiniBars convertem dados para números
- **`frontend/components/provider-card.tsx`**: `aggregateUsage()` converte `daily` antes de agregar

### 4. Flow de Conhecimento Atualizado

```
1. Receber documento → 2. Coletar amostras → 3. Analisar com Cortex (Ollama)
   [Cortex metrics: total_ms, tokens_generated, throughput_tps]
   ↓
4. Validar schema → 5. Aguardando confirmação
   (se confirmado)
   ↓
6. [_flow_end_time definido] → Chunking → Embedding (Ollama)
   [embedding_latency_ms calculado]
   ↓
7. Salvar no Qdrant → 8. Salvar usage em providers_usage [processing_time_ms, chunk_count]
```

### 5. API Response - Models com Usage

```json
{
  "providers": [{
    "id": "uuid",
    "name": "Ollama (Local)",
    "type": "local",
    "models": [{
      "id": "uuid",
      "name": "qwen2.5:7b-instruct",
      "status": "ready",
      "usage": {
        "requests": 42,
        "tokens": 12800,
        "avgLatencyMs": 2450,
        "daily": [5, 8, 12, 7, 3, 0, 0]
      }
    }]
  }]
}
```

### 6. Próximos Passos

1. Executar migration: `psql -f backend/migration_providers_usage.sql`
2. Reiniciar o backend para carregar nova query
3. Testar com upload de documento na tela de Knowledge
4. Verificar métricas aparecendo na tela de Models