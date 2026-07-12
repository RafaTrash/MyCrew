# Notices de terceiros

Este repositorio (codigo proprio: `backend/`, `frontend/`, `agents/`, workflows em
`automation/n8n/workflows/`) e distribuido sob a licenca MIT — veja `LICENSE`.

O `docker-compose.yml` orquestra as seguintes imagens de terceiros, cada uma com
sua propria licenca. Nenhum codigo-fonte delas e redistribuido neste repositorio;
o compose apenas faz `pull` das imagens publicas oficiais.

| Servico | Projeto | Licenca |
|---|---|---|
| `ollama` | [Ollama](https://github.com/ollama/ollama) | MIT |
| `open-webui` | [Open WebUI](https://github.com/open-webui/open-webui) | BSD-3-Clause (com clausula adicional de branding) |
| `qdrant` | [Qdrant](https://github.com/qdrant/qdrant) | Apache 2.0 |
| `n8n` | [n8n](https://github.com/n8n-io/n8n) | Sustainable Use License / n8n Enterprise (fair-code, nao e OSI-approved — uso comercial de terceiros como SaaS e restrito) |
| `dozzle` | [Dozzle](https://github.com/amir20/dozzle) | MIT |
| `portainer` | [Portainer CE](https://github.com/portainer/portainer) | zlib |
| `uptime-kuma` | [Uptime Kuma](https://github.com/louislam/uptime-kuma) | MIT |
| `aider` | [Aider](https://github.com/Aider-AI/aider) | Apache 2.0 |
| `nginx` | [Nginx](https://github.com/nginx/nginx) | BSD-2-Clause |
| `fastapi` (usado no `python-webapp`) | [FastAPI](https://github.com/tiangolo/fastapi) | MIT |

> As licencas acima refletem o entendimento no momento da escrita deste NOTICE
> (2026) e podem mudar entre versoes. Antes de qualquer uso comercial —
> especialmente envolvendo `n8n` como servico oferecido a terceiros — confirme
> os termos atuais diretamente com cada projeto/fabricante.

Marcas, nomes e logos de cada projeto citados neste repositorio (inclusive
badges no `README.md`) pertencem aos respectivos detentores e sao usados apenas
para fins de identificacao, sem implicar afiliacao ou endosso.
