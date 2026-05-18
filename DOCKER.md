# TechManager — Docker Containerisation Guide

## Container Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Docker Host (your machine)                       │
│                                                                      │
│   Host Port 4200          Host Port 3000        Host Port 3306*     │
│        │                       │                      │             │
│  ┌─────▼──────────────────┐    │    ┌──────────────────▼──────────┐ │
│  │   techmanager_frontend │    │    │      techmanager_db          │ │
│  │   (nginx:1.27-alpine)  │    │    │      (mysql:8.0)             │ │
│  │                        │    │    │                              │ │
│  │  /usr/share/nginx/html │    │    │  /var/lib/mysql              │ │
│  │  ← Angular SPA bundle  │    │    │  ← mysql-data volume         │ │
│  │                        │    │    │                              │ │
│  │  /api/* ──────────────────┐ │    │  /docker-entrypoint-initdb.d │ │
│  │  proxy_pass to backend │  │ │    │  ← 01-schema.sql (auto-init) │ │
│  └────────────────────────┘  │ │    └──────────────────────────────┘ │
│                               │ │                  │                  │
│  ┌────────────────────────────▼─▼────────────────┐ │                  │
│  │           techmanager_backend                  │ │                  │
│  │           (node:20-alpine)                     │ │                  │
│  │                                                │ │                  │
│  │  src/server.js → Express API                   │ │                  │
│  │  PORT 3000                                     │ │                  │
│  │  Connects to db:3306 via Docker DNS ───────────┼─┘                  │
│  └────────────────────────────────────────────────┘                    │
│                                                                         │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  techmanager-net (bridge 172.30.0.0/24) ┄┄┄┄┄┄┄┄ │
└─────────────────────────────────────────────────────────────────────────┘

* DB port only exposed on 127.0.0.1 by default (configurable via .env)
```

---

## ⚡ One-Command Quickstart

```bash
# 1. Clone / enter the project
cd techmanager

# 2. Create your .env from the template (REQUIRED)
cp .env.example .env
#    → Edit .env: set real JWT_SECRET values at minimum

# 3. Build all images and start the stack
docker-compose up --build

# That's it. Open http://localhost:4200
# Default admin login:  admin@techmanager.local / Admin@1234
```

---

## 📁 Docker File Structure

```
techmanager/
├── docker-compose.yml           ← Main stack definition
├── docker-compose.override.yml  ← Dev overrides (auto-merged locally)
├── docker-compose.prod.yml      ← Production hardening
├── .env.example                 ← Template — copy to .env
├── .dockerignore                ← Root-level ignore
│
├── frontend/
│   ├── Dockerfile               ← Stage 1: Node build → Stage 2: Nginx serve
│   ├── nginx.conf               ← SPA routing + /api proxy + gzip + security headers
│   ├── .dockerignore
│   ├── proxy.conf.json          ← Used by ng serve (no Docker)
│   └── src/
│       └── environments/
│           ├── environment.ts       ← Development (localhost:3000)
│           └── environment.prod.ts  ← Production (placeholder replaced by Dockerfile)
│
├── backend/
│   ├── Dockerfile               ← Multi-stage: deps → production (non-root)
│   └── .dockerignore
│
└── docker/
    └── mysql/
        ├── init/
        │   └── 01-schema.sql    ← Auto-executed on first DB start
        └── conf/
            └── my.cnf           ← Custom MySQL 8 config
```

---

## 🏗️ Dockerfile Details

### Frontend (2-stage build)

```
Stage 1: builder (node:20-alpine)          Stage 2: production (nginx:1.27-alpine)
────────────────────────────────           ────────────────────────────────────────
COPY package*.json                         COPY --from=builder /app/dist/techmanager
npm ci                          ───────►   COPY nginx.conf
COPY src/                                  EXPOSE 80
sed inject API_URL placeholder             CMD nginx -g "daemon off;"
ng build --configuration production

Final image size: ~1.1 GB (builder)        Final image size: ~25 MB ✓
```

**The `sed` injection trick:**
```bash
# In environment.prod.ts:
apiUrl: '__API_URL__',      ← placeholder

# Dockerfile runs before ng build:
RUN sed -i "s|__API_URL__|${API_URL}|g" src/environments/environment.prod.ts

# Result baked into the bundle:
apiUrl: '/api',             ← replaced at build time
```

### Backend (multi-stage for layer caching)

```
Stage: deps                                Stage: production
────────────────────────────────           ────────────────────────────────
COPY package*.json                         COPY --from=deps node_modules/
npm ci --omit=dev            ───────►      COPY src/
                                           USER node (non-root)
                                           HEALTHCHECK wget /api/health
                                           ENTRYPOINT dumb-init --
                                           CMD node src/server.js

Rebuilds node_modules only when            Source changes → fast rebuild ✓
package.json changes          
```

---

## 🌐 Networking

All containers share the `techmanager-net` bridge network (`172.30.0.0/24`).
Docker's internal DNS lets containers reference each other **by service name**:

| From         | To         | Resolves to   | Port |
|--------------|------------|---------------|------|
| `backend`    | `db`       | `db`          | 3306 |
| `frontend`   | `backend`  | `backend`     | 3000 |
| Your browser | `frontend` | `localhost`   | 4200 |
| Your browser | `backend`  | `localhost`   | 3000 |

**Why the Nginx proxy matters:**
The browser calls `/api/users` → Nginx on port 80 receives it → proxies to `http://backend:3000/api/users` internally. The browser never sees the backend port. No CORS headers needed in production.

---

## 🔒 Healthcheck Chain

```
docker-compose up --build
         │
         ▼
   [db] starts MySQL
         │
         ├─ healthcheck: mysqladmin ping every 15s
         │  start_period=30s  retries=8
         │
         ▼  (condition: service_healthy)
   [backend] starts Node.js
         │
         ├─ healthcheck: wget /api/health every 20s
         │  start_period=20s  retries=5
         │
         ▼  (condition: service_healthy)
   [frontend] starts Nginx
         │
         └─ healthcheck: wget /health every 30s
```

This guarantees:
1. MySQL is **accepting connections** before Node.js tries to connect
2. The API is **responding** before Nginx starts serving
3. No "connection refused" race conditions on cold start

---

## ⚙️ Environment Variables Reference

| Variable               | Used by          | Description                              | Default                |
|------------------------|------------------|------------------------------------------|------------------------|
| `MYSQL_ROOT_PASSWORD`  | db               | MySQL root password                      | —                      |
| `MYSQL_DATABASE`       | db, backend      | Database name                            | `techmanager`          |
| `MYSQL_USER`           | db, backend      | App DB user                              | `techmanager`          |
| `MYSQL_PASSWORD`       | db, backend      | App DB password                          | —                      |
| `DB_HOST_PORT`         | db (host)        | Host binding for MySQL port              | `127.0.0.1:3306`       |
| `NODE_ENV`             | backend          | Node environment                         | `production`           |
| `BACKEND_PORT`         | backend (host)   | Host port for API                        | `3000`                 |
| `JWT_SECRET`           | backend          | Access token signing key                 | **must set**           |
| `JWT_REFRESH_SECRET`   | backend          | Refresh token signing key                | **must set**           |
| `JWT_EXPIRES_IN`       | backend          | Access token lifespan                    | `15m`                  |
| `LOG_LEVEL`            | backend          | Winston log verbosity                    | `info`                 |
| `FRONTEND_ORIGIN`      | backend          | CORS allowed origin                      | `http://localhost:4200`|
| `FRONTEND_API_URL`     | frontend (build) | API URL baked into Angular bundle        | `/api`                 |
| `FRONTEND_PORT`        | frontend (host)  | Host port for UI                         | `4200`                 |
| `IMAGE_TAG`            | compose          | Docker image tag                         | `latest`               |

---

## 🛠️ Common Commands

```bash
# ── Start / Stop ──────────────────────────────────────────────────────────────

# Start everything (build if not built)
docker-compose up --build

# Start in background (detached)
docker-compose up --build -d

# Stop all containers (keep volumes)
docker-compose down

# Stop and DELETE all data volumes (fresh start)
docker-compose down -v

# ── Logs ──────────────────────────────────────────────────────────────────────

# Follow all logs
docker-compose logs -f

# Follow only backend
docker-compose logs -f backend

# Follow only DB (useful for init debugging)
docker-compose logs -f db

# ── Rebuild single service ────────────────────────────────────────────────────

# Rebuild only the frontend image (e.g. after code change)
docker-compose build frontend
docker-compose up -d --no-deps frontend

# ── Shell access ──────────────────────────────────────────────────────────────

# Open a shell in the backend container
docker exec -it techmanager_backend sh

# MySQL client inside the db container
docker exec -it techmanager_db mysql -u techmanager -p techmanager

# ── Health status ──────────────────────────────────────────────────────────────
docker-compose ps

# ── Production deployment ─────────────────────────────────────────────────────
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## 🔄 Database Init Explained

MySQL's entrypoint runs all files in `/docker-entrypoint-initdb.d/` **only when the data directory is empty** (i.e. first container start with a fresh volume).

```
Volume empty?
     YES → Run 01-schema.sql → Create tables → Insert seed data → Start MySQL
     NO  → Skip initdb entirely → Start MySQL (your existing data is safe)
```

To **force a re-init** (destroys all data):
```bash
docker-compose down -v          # Delete the mysql-data volume
docker-compose up --build db    # Recreate and re-run 01-schema.sql
```

---

## 🏭 Production Checklist

```bash
# Generate secure JWT secrets
openssl rand -hex 64   # Copy output → JWT_SECRET in .env
openssl rand -hex 64   # Copy output → JWT_REFRESH_SECRET in .env

# Set strong DB passwords in .env

# Set FRONTEND_API_URL to your real domain
FRONTEND_API_URL=https://api.yourdomain.com/api

# Build with production compose override
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d

# Verify all services are healthy
docker-compose ps
```

---

## 🐛 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `backend` exits immediately | DB not ready yet | Normal — Compose retries. Check `docker-compose logs db` |
| `Access denied for user` | Wrong credentials in .env | Ensure `MYSQL_USER/PASSWORD` match `DB_USER/PASSWORD` |
| `ng build` fails in Docker | Missing `package-lock.json` | Run `npm install` locally first to generate it |
| `404` on Angular routes | Nginx missing try_files | Ensure `nginx.conf` is copied correctly into the image |
| API returns CORS error | `FRONTEND_ORIGIN` mismatch | Set it to the exact origin the browser uses |
| DB data lost on restart | Volume not created | Check `docker volume ls` — ensure `techmanager_mysql_data` exists |
