# MyCrew AI Local Stack

Arquitetura atual: frontend e backend separados.

## Componentes

- `mycrew-frontend` (Nginx): interface web para chat, anexar conhecimento e acionar fluxos.
- `python-webapp` (FastAPI): API principal de chat, personas, knowledge e execucao de fluxos n8n.
- `open-webui`: gestao de modelos/agentes.
- `ollama`: inferencia local e embeddings.
- `qdrant`: memoria vetorial para retroalimentacao.
- `n8n`: orquestracao de fluxos de conversa e conhecimento.
- `dozzle`: visualizacao de logs dos containers do stack em tempo real.
- `portainer`: gestao e monitoramento dos containers/volumes/redes Docker.
- `uptime-kuma`: monitoramento de disponibilidade (uptime) dos servicos do stack.
- `aider` (Dev Agent): agente de desenvolvimento para geracao, edicao e revisao de codigo assistida por IA.

## Subir ambiente

```bash
docker compose up -d --build
```

## URLs

- Frontend MyCrew: `http://localhost:8081`
- Backend API (docs): `http://localhost:8082/docs`
- Open WebUI: `http://localhost:3001`
- Ollama: `http://localhost:11435`
- Qdrant: `http://localhost:6333`
- n8n: `http://localhost:5678`
- Dozzle (logs): `http://localhost:8085/dozzle`
- Portainer (gestao Docker): `http://localhost:9000`
- Uptime Kuma (monitoramento): `http://localhost:3002`
- Aider (Dev Agent): `http://localhost:8501`

> Nota: o Ollama roda na porta `11435` (nao a padrao `11434`) neste stack — ajustar integracoes/scripts externos de acordo.

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

## Observabilidade e gestao do stack

- **Dozzle** (`http://localhost:8085/dozzle`): acompanha logs de todos os containers em tempo real, util para debug rapido sem precisar de `docker logs` manual.
- **Portainer** (`http://localhost:9000`): interface de gestao Docker (containers, imagens, volumes, redes) — util para reiniciar/atualizar servicos sem linha de comando.
- **Uptime Kuma** (`http://localhost:3002`): monitor de disponibilidade dos servicos do stack (Open WebUI, n8n, backend, etc.), com alertas configuraveis.

## Dev Agent (Aider)

- **Aider** (`http://localhost:8501`): agente de desenvolvimento assistido por IA, usado para gerar, editar e revisar codigo do proprio stack (backend, fluxos, integracoes) de forma conversacional.
- Recomenda-se restringir o acesso a essa porta ao ambiente local/dev, ja que o agente pode alterar arquivos do projeto.

## Compatibilidade com workflows existentes

Os fluxos em `automation/n8n/workflows/` continuam validos.

Se um node no n8n apontar para `http://python-webapp:80`, permanece compativel.