# =============================================================================
# Stage 1 — BUILD
# Use the official Node LTS on Alpine for the smallest possible builder image.
# =============================================================================
FROM node:20-alpine AS builder

# Build-time argument so the same Dockerfile works for every environment.
# Override at build time:  docker build --build-arg API_URL=https://api.example.com
ARG API_URL=http://localhost:3000/api
ENV API_URL=${API_URL}

# Set a dedicated work directory
WORKDIR /app

# ── Dependency install (layer-cached unless package files change) ─────────────
# Copy only the manifest files first so Docker can cache the npm install layer
# independently of source-code changes.
COPY package.json package-lock.json* ./

# ci is faster and stricter than install; --legacy-peer-deps handles Angular
# Material peer-dep quirks in some setups.
RUN npm install --legacy-peer-deps

# ── Copy source ───────────────────────────────────────────────────────────────
COPY . .

# ── Inject runtime API URL into Angular environments ─────────────────────────
# sed replaces the placeholder token in environment.prod.ts so the build
# embeds the correct backend URL without modifying source files.
RUN sed -i "s|__API_URL__|${API_URL}|g" src/environments/environment.prod.ts

# ── Build for production ──────────────────────────────────────────────────────
# --output-path keeps the artifact in a predictable location.
RUN npx ng build --configuration production --output-path=/app/dist/smart

# =============================================================================
# Stage 2 — SERVE
# Discard the 1 GB+ Node image completely; copy only the compiled static files
# into a 5 MB Nginx Alpine image.
# =============================================================================
FROM nginx:1.27-alpine AS production

# Remove the default Nginx welcome page
RUN rm -rf /usr/share/nginx/html/*

# Copy the compiled Angular app from the builder stage
COPY --from=builder /app/dist/smart /usr/share/nginx/html

# Bring in our custom Nginx config (handles SPA deep-linking, gzip, security)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Nginx listens on 80 inside the container.
# docker-compose.yml maps this to host port 4200 (or 80 in prod).
EXPOSE 80

# Run Nginx in the foreground so Docker can manage the process.
CMD ["nginx", "-g", "daemon off;"]
