# =============================================================================
# Dockerfile — SMaRT Backend (Node.js + Express)
# Strategy: separate dependency install from source copy for maximum layer cache
#            reuse; run as a non-root user in production.
# =============================================================================

# ── Base: Node 20 LTS on Alpine (tiny footprint ~50 MB vs ~900 MB on Debian) ──
FROM node:20-alpine AS base

# Install OS-level packages needed by some native npm modules.
# Also install `dumb-init` — a tiny init system that properly forwards signals
# (SIGTERM/SIGINT) to Node so graceful shutdowns work in Docker.
RUN apk add --no-cache \
        dumb-init \
        # mysql2 native bindings (optional, but avoids rebuild if used):
        python3 \
        make \
        g++

WORKDIR /app

# =============================================================================
# Stage: deps  — install production dependencies only
# This layer is invalidated only when package.json or package-lock.json change,
# NOT every time source code changes.
# =============================================================================
FROM base AS deps

COPY package.json package-lock.json* ./

# Deterministic production install using package-lock.json when available
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# =============================================================================
# Stage: production — the final, minimal runtime image
# =============================================================================
FROM node:20-alpine AS production

# Optional PDF tooling: keep backend build stable even when LibreOffice
# is unavailable for the base image/repository.
ARG INSTALL_LIBREOFFICE=false

# Re-install dumb-init in the final stage (base was an intermediate)
RUN apk add --no-cache dumb-init \
    && if [ "$INSTALL_LIBREOFFICE" = "true" ]; then apk add --no-cache libreoffice fontconfig; fi

WORKDIR /app

# ── Security: run as a non-root user ─────────────────────────────────────────
# Alpine's node image already ships a "node" user (uid 1000).
# We create the log directory with the right owner before switching users.
RUN mkdir -p logs && chown -R node:node /app

# ── Copy production node_modules from the deps stage ─────────────────────────
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# ── Copy application source code ─────────────────────────────────────────────
COPY --chown=node:node src/ ./src/
COPY --chown=node:node package.json ./

RUN if [ "$INSTALL_LIBREOFFICE" = "true" ]; then \
      mkdir -p /usr/share/fonts/truetype/redhat \
      && cp ./src/exports/fonts/*.ttf /usr/share/fonts/truetype/redhat/ \
      && chmod 644 /usr/share/fonts/truetype/redhat/*.ttf \
      && fc-cache -f; \
    fi

# ── Switch to non-root user ───────────────────────────────────────────────────
USER node

# ── Environment defaults (secrets MUST be injected at runtime via .env / orchestrator) ──
ENV NODE_ENV=production \
    PORT=3000 \
    DB_HOST=db \
    DB_PORT=3306 \
    DB_NAME=smart \
    DB_USER=smart \
    JWT_EXPIRES_IN=15m \
    LOG_LEVEL=info \
    FRONTEND_URL=http://localhost:4200

# ── Expose the API port ───────────────────────────────────────────────────────
EXPOSE 3000

# ── Health check ─────────────────────────────────────────────────────────────
# Docker checks this every 30 s; after 3 failures the container is "unhealthy".
# wget ships with Alpine and is lighter than curl.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

# ── Start command ─────────────────────────────────────────────────────────────
# dumb-init ensures signals are properly forwarded so Node can shut down cleanly.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
