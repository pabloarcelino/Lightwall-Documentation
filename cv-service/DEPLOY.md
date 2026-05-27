# Deploy do cv-service

Este documento descreve como subir o `cv-service` (Python/FastAPI) para que o
pipeline Node consiga chamá-lo via HTTP. O cv-service implementa o pipeline
OpenCV+Shapely da metodologia Fase E (envelope, paredes via skeletonization,
classificação topológica determinística por point-in-polygon).

Enquanto o cv-service **não estiver de pé**, a Etapa 3.4 do pipeline Node pula
silenciosamente com log `"cv-service offline — pulando (pipeline Gemini segue
normal)"` e tudo continua funcionando via Gemini (Fases A+B+D). Quando o
cv-service entrar no ar, a Etapa 3.4 começa a persistir resultados em
`extracted_data { elementType: "cv_extraction" }` e a Etapa 4.65 começa a
fazer a reconciliação conservadora CV↔LLM automaticamente.

---

## Pré-requisitos comuns

- `AI_INTEGRATIONS_GEMINI_API_KEY` ou `GEMINI_API_KEY` exposta como env var
  no cv-service (usado pelo módulo `spatial_reasoning.py` como fallback).
- Porta `8100` exposta.
- `CV_SERVICE_URL` configurada no servidor Node apontando para o host:porta
  do cv-service (default `http://localhost:8100`).

---

## Caminho A — Docker local (recomendado pra desenvolvimento)

O `docker-compose.yml` da raiz do projeto já tem o serviço configurado.

```bash
docker compose up cv-service
```

Verificar:

```bash
curl http://localhost:8100/health
```

Resposta esperada:

```json
{"status":"ok","service":"cv","version":"1.1.0"}
```

No `.env` do Node:

```env
CV_SERVICE_URL=http://cv-service:8100
```

Subir o stack completo (Node + cv-service + Postgres):

```bash
docker compose up
```

**Vantagens**: isolamento, idempotente, fácil de derrubar. **Desvantagem**:
~1.5 GB de imagem (OpenCV + EasyOCR + scikit-image + Shapely + alphashape).

---

## Caminho B — Replit (mesmo Repl ou separado)

### B1. Mesmo Repl (não recomendado)

Rodar o cv-service em background no mesmo Repl é teoricamente possível mas
**não recomendo**: Replit dá ~512MB RAM no free; EasyOCR sozinho consome
~600MB ao baixar modelos. PaddleOCR/torch piora.

### B2. Repl separado "Always On" (recomendado em Replit)

1. Criar um novo Repl, importar a pasta `cv-service/` do GitHub.
2. Configurar `run` no `.replit`:
   ```toml
   run = "uvicorn app.main:app --host 0.0.0.0 --port 8100"
   ```
3. Adicionar secret `AI_INTEGRATIONS_GEMINI_API_KEY`.
4. Ativar "Always On" (paid).
5. Pegar o URL público do Repl (ex: `https://lightwall-cv.username.repl.co`).
6. No Repl principal (Node), setar secret:
   ```env
   CV_SERVICE_URL=https://lightwall-cv.username.repl.co
   ```

---

## Caminho C — VPS / Render / Fly.io

### Render (mais simples)

1. New → Web Service → conectar repo do GitHub.
2. Configurações:
   - **Environment**: Docker
   - **Build context**: `./cv-service`
   - **Dockerfile path**: `cv-service/Dockerfile`
   - **Health check path**: `/health`
   - **Plan**: Standard ($25/mês — Free não tem RAM suficiente).
3. Env vars:
   - `AI_INTEGRATIONS_GEMINI_API_KEY`
   - `PORT=8100`
4. Deploy. Anote a URL pública (HTTPS).
5. No Node, setar `CV_SERVICE_URL=https://lightwall-cv.onrender.com`.

### Fly.io

```bash
cd cv-service
fly launch --dockerfile Dockerfile
fly secrets set AI_INTEGRATIONS_GEMINI_API_KEY="..."
fly deploy
```

### VPS próprio (DigitalOcean, Hetzner, AWS Lightsail)

```bash
# Na VPS:
git clone <repo>
cd Lightwall-Orcamento/cv-service
docker build -t lightwall-cv .
docker run -d --name lightwall-cv -p 8100:8100 \
  -e AI_INTEGRATIONS_GEMINI_API_KEY="..." \
  --restart unless-stopped \
  lightwall-cv
```

Configurar Nginx/Caddy como reverse proxy + HTTPS via Let's Encrypt para
o domínio do serviço CV. Depois, no Node:

```env
CV_SERVICE_URL=https://cv.seu-dominio.com
```

---

## Troubleshooting

### Health endpoint responde 200 mas /extraction/full_extraction retorna `status: "stub"`

Isso significava que a versão antiga (Fase E.1) estava ativa. A versão atual
(Fase E.5+) tem implementação real. Confirme:

```bash
curl -s http://localhost:8100/health | jq '.version'
# deve retornar "1.1.0" ou mais novo
```

Se for "1.0.0", rebuilde o container.

### Primeira chamada demora 20-60 segundos

Normal: `EasyOCR.Reader(["pt", "en"])` baixa os modelos de OCR (~600MB)
na primeira inicialização. Pré-aqueça subindo um arquivo de teste após
deploy.

### Erro `ImportError: alphashape`

Verifique se `requirements.txt` está atualizado e o build pulou cache:

```bash
docker compose build --no-cache cv-service
docker compose up cv-service
```

### Container `OOMKilled` (Out Of Memory)

Aumentar memória da máquina (mínimo 2GB; recomendado 4GB). Em Render,
upgrade pra Standard ou Pro plan.

### CORS bloqueando requisições do navegador

Já tratado em `app/main.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Se ainda bloquear, verifique se há reverse proxy (Nginx) reescrevendo
headers.

### "cv-service offline" no Node mesmo com container rodando

1. Cheque `CV_SERVICE_URL` no Node (Replit Secrets ou `.env`).
2. Teste alcance:
   ```bash
   docker exec <node-container> curl http://cv-service:8100/health
   ```
3. Se for cross-host (Node em Replit, CV em Render), URL precisa ser HTTPS
   pública.

---

## Verificação pós-deploy

Depois de subir, no Node:

```bash
curl http://localhost:5000/api/cv-service/health
```

Resposta esperada:

```json
{"reachable":true,"url":"http://cv-service:8100","ready":true,"version":"1.1.0","latencyMs":42}
```

`ready: true` significa que o endpoint `/extraction/full_extraction` está
respondendo `status="ok"` para uma chamada de teste. Se `ready: false`, o
serviço está no ar mas em modo stub — verifique a versão.

Reprocesse um projeto e cheque os logs do Node:

```
[CV] Pav "Terreo": status=ok walls=15 envelope=sim rooms=6 cotas=24 inference_ms=4280
[CV-RECONCILE] 12 matched, 2 disagreed, 3 only_llm, 1 only_cv
```

Esses logs significam que tudo está conversando direito. Na UI, abra a
aba Quantitativos: badges verdes (✓ CV) e laranjas (⚠ CV divergente) devem
aparecer nas paredes correspondentes.
