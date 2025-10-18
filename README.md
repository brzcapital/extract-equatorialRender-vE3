# vE3 — Extrator Equatorial (Render-ready)

## Endpoints
- `GET /health` → status
- `GET /logs?n=50` → últimos logs
- `POST /extract-pdf` (multipart/form-data; campo **fatura**) → JSON estruturado

## Variáveis de ambiente
- `OPENAI_USE_GPT` = "true" ou "false" (default false)
- `OPENAI_PRIMARY_MODEL` (ex: "gpt-4o-mini" ou "gpt-4-turbo")
- `OPENAI_FALLBACK_MODEL` (ex: "gpt-5-mini")
- `OPENAI_API_KEY` (quando `OPENAI_USE_GPT=true`)

## Teste (Postman)
- POST `{{BASE_URL}}/extract-pdf`
- Body → form-data → Key: `fatura` (File) → selecione o PDF