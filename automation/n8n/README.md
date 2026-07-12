# n8n Workflows (MyCrew)

## Arquivo pronto para importar

- `workflows/openwebui-qdrant-inventario.json`
- `workflows/clovis-triagem-resposta.json`

## Como importar no n8n

1. Abra o n8n em `http://localhost:5678`.
2. Clique em **Workflows** > **Import from File**.
3. Selecione `automation/n8n/workflows/openwebui-qdrant-inventario.json`.
4. Abra o node **Config** e preencha:

- `openwebuiBaseUrl`: `http://open-webui:8080`
- `openwebuiApiKey`: sua chave API do Open WebUI (recomendado)
- `openwebuiToken`: seu token JWT (opcional; usado se `openwebuiApiKey` estiver vazio)
- `qdrantUrl`: `http://qdrant:6333`
- `agentPrefix`: deixe vazio para considerar todos os modelos como agentes (ou use `custom-` se seus modelos tiverem prefixo)

5. Execute com **Execute workflow**.

## Exemplo inicial com o Clovis

Este workflow foi criado para ser o primeiro chat separado por agente com entrada e saida no Slack.

O que ele faz:

- recebe um comando ou webhook do Slack para o Clovis;
- busca o documento local do Clovis via `python-webapp`;
- consulta o Qdrant com embedding gerado no Ollama;
- checa o checklist minimo de avaliacao;
- pede os dados que estiverem faltando;
- se o contexto estiver completo, chama o modelo do Clovis com uma resposta estruturada.

Para importar:

1. Abra o n8n em `http://localhost:5678`.
2. Clique em **Workflows** > **Import from File**.
3. Selecione `automation/n8n/workflows/clovis-triagem-resposta.json`.
4. Execute com **Execute workflow**.

Para conectar com Slack:

1. Configure o Slack App para chamar o webhook do n8n.
2. Use o caminho `mycrew/clovis` como entrada.
3. Preencha `slackBotToken` no node `Config Clovis`.
4. Opcionalmente defina `slackDefaultChannel` para teste rapido.
5. Se o Ollama nao tiver o modelo de embedding configurado, ajuste `embeddingModel` no node `Config Clovis`.

A logica de triagem e resposta do Clovis permanece igual; o que muda e apenas o transporte de entrada e saida.

### Variaveis do `Config Clovis`

- `pythonWebappBaseUrl`: deve apontar para `http://python-webapp:80` dentro do Docker.
- `qdrantUrl`: deve apontar para `http://qdrant:6333` dentro do Docker.
- `qdrantCollectionName`: nome da colecao que armazena o contexto recuperavel.
- `embeddingModel`: modelo do Ollama usado para a busca semantica.
- `qdrantTopK`: quantidade de resultados recuperados.
- `slackBotToken`: token do bot do Slack.

Observacao de fluxo: as variaveis do node **Config** sao propagadas internamente pelos nodes de normalizacao. Assim, os requests seguintes usam `{{$json.openwebuiBaseUrl}}`, `{{$json.openwebuiApiKey}}` e `{{$json.qdrantUrl}}` de forma consistente.

## O que o workflow retorna

- Lista de modelos do Open WebUI.
- Lista de agentes por prefixo (ou todos os modelos, se prefixo estiver vazio).
- Lista de chats do Open WebUI.
- Lista de colecoes do Qdrant.
- Resumo consolidado com contagens.

Se o endpoint de chats retornar lista vazia (`[]`), o workflow continua mesmo assim e o resumo mostra `totalChats: 0`.

## Como obter API key no Open WebUI

1. Abra `http://localhost:3001`.
2. Faça login com seu usuario.
3. Vá em **Settings** > **Account** > **API Keys**.
4. Gere uma nova chave e copie para o node **Config** no n8n.

## Observacao importante sobre "agentes"

Neste stack, os "agentes" aparecem como modelos na API. Se houver prefixo (ex.: `custom-`), ele e usado no filtro. Se o prefixo estiver vazio, o workflow considera todos os modelos como agentes.

## Erro "access to env vars denied"

Se esse erro aparecer no n8n, use este workflow atualizado (sem `$env`) e configure tudo no node **Config**.

## Se vier vazio em /models/list

Se o node de modelos nao retornar itens, a causa mais comum e credencial invalida/revogada (API key ou JWT).\
Neste caso, o workflow mostra erro explicito de `401 Unauthorized`.

Checklist rapido:

- Dentro do n8n (docker), `openwebuiBaseUrl` deve ser `http://open-webui:8080`.
- `openwebuiApiKey` deve ser uma chave valida do Open WebUI (ou use `openwebuiToken` JWT).
- Teste no host: `curl -H "Authorization: Bearer SUA_CHAVE" http://localhost:3001/api/v1/models/list`.

## OPENWEBUI_AGENT_PREFIX

Use assim:

- Vazio (`""`): considera todos os modelos como agentes.
- `custom-`: so modelos cujo id/nome comeca com `custom-`.

No seu ambiente atual, como os ids estao como `boris`, `clovis`, `elliot`, `bruce`, mantenha vazio.

## Porta 8080 x 3001 (importante)

- Dentro do n8n (rede Docker): use `http://open-webui:8080`.
- No navegador/host: use `http://localhost:3001`.

O workflow usa a URL interna, que e a correta para comunicacao entre containers.

## Base de conhecimento do Clovis

O Clovis pode ler uma pasta propria com documentos locais. Coloque os materiais dele em `agents/clovis/` usando arquivos `.md` ou `.txt`.

Sugestao de organizacao:

- `00-base-de-conhecimento.md` para o material principal.
- `01-fases-do-ciclo.md` para ciclo e fases.
- `02-nutricao-e-rega.md` para manejo operacional.
- `03-sintomas-e-diagnosticos.md` para problemas comuns.
