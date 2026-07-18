# Plano de Refatoração do Backend

## Problema Atual
- `main.py` com 1392 linhas contendo todos os endpoints
- Difícil manutenção e localização de código
- Queries SQL complexas misturadas com lógica de endpoint

## Estrutura Proposta

```
backend/
├── main.py                    # FastAPI app + CORS + includes
├── dependencies.py            # DB, auth dependencies globais
├── routers/
│   ├── __init__.py
│   ├── auth.py              # /auth/*
│   ├── providers.py         # /providers, /me/providers/*
│   ├── models.py            # /models, /models/sync
│   ├── agents.py            # /agents
│   └── knowledge.py         # /knowledge/*
├── schemas/
│   ├── __init__.py
│   ├── auth.py
│   ├── providers.py
│   └── knowledge.py
└── core/
    ├── __init__.py
    ├── database.py          # Conexão única
    └── utils.py             # Funções auxiliares
```

## Benefícios
1. Cada router com responsabilidade única
2. Main.py limpo com apenas 50-100 linhas
3. Identificar código não utilizado mais fácil
4. Melhor testabilidade

## Passos de Implementação
1. ✅ Criar estrutura de diretórios
2. ✅ Criar core/database.py
3. ✅ Criar routers/auth.py
4. ⏳ Criar routers/providers.py
5. ⏳ Criar routers/models.py
6. ⏳ Criar routers/agents.py
7. ⏳ Criar routers/knowledge.py
8. ⏳ Atualizar main.py para usar routers
9. ⏳ Testar todos os endpoints

## Ação Imediata
O frontend está com token expirado - necessário login novamente para testar a tela de Models.