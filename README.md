# MyCrew AI Local Stack

Arquitetura atual: frontend e backend separados.

## Componentes

- `mycrew-frontend` (Nginx): interface web para chat, anexar conhecimento e acionar fluxos.
- `python-webapp` (FastAPI): API principal de chat, personas, knowledge e execucao de fluxos n8n.
- `open-webui`: gestao de modelos/agentes.
- `ollama`: inferencia local e embeddings.
- `qdrant`: memoria vetorial para retroalimentacao.
- `n8n`: orquestracao de fluxos de conversa e conhecimento.

## Subir ambiente

```bash
docker compose up -d --build
```

## URLs

- Frontend MyCrew: `http://localhost:8081`
- Backend API (docs): `http://localhost:8082/docs`
- Open WebUI: `http://localhost:3001`
- n8n: `http://localhost:5678`
- Qdrant: `http://localhost:6333`

## Endpoints principais (backend)

- `GET /api/status`: status de servicos, modelos e agentes OpenWebUI.
- `GET /api/personas`: lista agentes locais + agentes encontrados no OpenWebUI.
- `POST /api/chat`: conversa com recuperacao de contexto do Qdrant.
- `POST /api/knowledge/attach`: anexa conhecimento no Qdrant por agente.
- `GET /api/knowledge/search`: busca conhecimento por agente.
- `POST /api/flows/start`: dispara fluxo no n8n (`chat` ou `knowledge`).
- `GET /api/flows/{flow_id}`: consulta status de execucao do fluxo.
- `GET /api/agent-doc`: retorna arquivo `.md` do agente local.

## Retroalimentacao

A retroalimentacao funciona em dois caminhos:

1. Direto pela API:
- frontend envia conteudo para `POST /api/knowledge/attach`;
- backend quebra em chunks, gera embedding no Ollama;
- backend faz upsert no Qdrant com metadata por agente.

2. Via fluxo n8n:
- frontend aciona `POST /api/flows/start`;
- backend chama webhook do n8n;
- frontend acompanha `GET /api/flows/{flow_id}`.

## Variaveis de ambiente recomendadas

No `.env`, configure:

- `OPEN_WEBUI_API_KEY` ou `OPEN_WEBUI_TOKEN`
- `QDRANT_COLLECTION=mycrew_knowledge`
- `EMBEDDING_MODEL=nomic-embed-text`
- `N8N_CHAT_FLOW_WEBHOOK=` URL de webhook para fluxo de conversa
- `N8N_KNOWLEDGE_FLOW_WEBHOOK=` URL de webhook para fluxo de anexos/conhecimento

Sem os webhooks, chat e knowledge direto continuam funcionando; apenas o caminho de fluxo n8n fica indisponivel.

## Compatibilidade com workflows existentes

Os fluxos em `automation/n8n/workflows/` continuam validos, principalmente para `clovis`.

Se um node no n8n apontar para `http://python-webapp:80`, permanece compativel.
