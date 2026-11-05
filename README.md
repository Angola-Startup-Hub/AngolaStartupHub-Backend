# Angola Startup Hub — API

Express + Prisma + Neon (Postgres e Object Storage), pronta para Vercel (serverless).

## Local
```bash
npm install
npm run db:push     # cria as tabelas (usa .env.local do Neon)
npm run dev         # http://localhost:4000
```
Ficheiros de ambiente: `.env.local` (gerado pelo `neon deploy`) e `.env` (ver `.env.example`).

## Deploy no Vercel
1. Importa este repositório no Vercel (Framework: *Other*). Região das funções: `iad1`, perto do Neon (us-east-2).
2. Define as variáveis de ambiente (Production):
   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | do `.env.local` (pooled) |
   | `DATABASE_URL_UNPOOLED` | do `.env.local` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION` | do `.env.local` |
   | `S3_BUCKET` | `news` |
   | `JWT_SECRET` | string aleatória longa |
   | `ADMIN_EMAIL`, `ADMIN_NAME` | os teus |
   | `ADMIN_PASSWORD_HASH` | `npm run hash -- "password"` |
   | `CORS_ORIGINS` | domínio do site, ex. `https://angolastartup.vercel.app` |
3. Deploy. Testa `GET /` → `{"ok":true}`.

As tabelas já foram criadas com `npm run db:push`; para alterações futuras ao schema, volta a corrê-lo localmente.
