# Local test environment (ĀKĀRA)

## Why
Cross-check changes before shipping zips so production does not absorb preventable mistakes.

## Requirements
- Node 20+
- PostgreSQL 14+ (local or Docker)
- Copy `.env.example` → `.env` with `DATABASE_URL`, `SESSION_SECRET`, etc.

## Postgres (Docker example)
```bash
docker run -d --name akara-pg -e POSTGRES_PASSWORD=akara -e POSTGRES_DB=akara -p 5432:5432 postgres:16
export DATABASE_URL=postgres://postgres:akara@127.0.0.1:5432/akara
```

## Bootstrap
```bash
cd akara-work
npm ci
npm run db:sync          # schema + CMS seeds
npm run seed             # if you use product seed
npm run build
npm start                # or node server.js
```

## Smoke after each change
1. Home hero — emphasis word readable; secondary CTA solid cream
2. Header wordmark size
3. Super admin → Settings → Sales mode toggle → products show Sold Out; checkout 503
4. Toggle off → buy path works
5. `node --check server.js` and critical route files

## Note on this sandbox
The agent environment may not keep a long-running Postgres instance; always re-run smoke on your machine or Railway staging before production deploy.
