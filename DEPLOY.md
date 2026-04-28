# Deploy com Docker Compose

Este projeto pode ser subido em uma VPS Linux com Docker Compose sem depender do `migration.sql`.

## Fluxo adotado

- O banco e inicializado a partir do schema atual em `shared/schema.ts`
- O bootstrap do banco usa `npm run db:push`
- O catalogo base e preenchido automaticamente pela aplicacao se estiver vazio
- O `migration.sql` permanece apenas como referencia historica e nao deve ser usado como fonte principal de setup

## Arquivos de ambiente

1. Copie `.env.example` para `.env`
2. Preencha pelo menos:

```env
AI_INTEGRATIONS_GEMINI_API_KEY=...
SESSION_SECRET=troque-isto-em-producao
DEFAULT_ADMIN_PASSWORD=troque-isto-em-producao
```

Observacoes:

- `DATABASE_URL` nao precisa ser ajustada se voce usar o `docker-compose.yml` padrao
- O `cv-service` reutiliza `AI_INTEGRATIONS_GEMINI_API_KEY`
- Se o `cv-service` falhar, a aplicacao ainda possui fallback para `gemini-only`

## Subida

```bash
docker compose up -d --build
```

O container `app` executa automaticamente:

```bash
npm run db:push
npm start
```

Se voce quiser repovoar o catalogo manualmente:

```bash
docker compose exec app npm run db:seed
```

## Primeiro acesso

- URL: `http://IP_DA_VPS:5000`
- Usuario padrao: `admin`
- Senha padrao: valor de `DEFAULT_ADMIN_PASSWORD`

## Persistencia

- Banco: volume `postgres_data`
- Uploads: volume `app_uploads`

## Atualizacao

Depois de um novo `git pull`:

```bash
docker compose up -d --build
```

Isso recompila a aplicacao e reaplica o schema atual no banco.
