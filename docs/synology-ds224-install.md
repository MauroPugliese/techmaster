# Synology DS224+ Install Guide

This project runs well on a Synology DS224+ with Container Manager. Use the Docker setup already included in this repository.

## 1. Prepare the NAS

1. Update DSM to the latest stable release.
2. Install `Container Manager` from Package Center.
3. Create a shared folder such as `docker/techmanager_agent`.
4. Copy this repository into that folder.
5. In DSM, enable SSH only if you want to use the terminal for deployment.

## 2. Create the environment file

1. In the project root, copy `.env.example` to `.env`.
2. Change these values first:
   - `MYSQL_ROOT_PASSWORD`
   - `MYSQL_PASSWORD`
   - `JWT_SECRET`
   - `JWT_REFRESH_SECRET`
   - `FRONTEND_ORIGIN`
3. For a simple LAN-only install, set:

```env
FRONTEND_ORIGIN=http://YOUR_NAS_IP:4200
FRONTEND_API_URL=/api
DB_HOST_PORT=127.0.0.1:3306
```

## 3. Start the stack

From the project root, run:

```bash
docker compose up -d --build
```

If Synology only supports the legacy command in your shell, run:

```bash
docker-compose up -d --build
```

## 4. First access

1. Open `http://YOUR_NAS_IP:4200`
2. Wait until all containers are healthy.
3. Check status with:

```bash
docker compose ps
```

4. Check logs if needed:

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f db
```

## 5. Optional reverse proxy on Synology

Use this if you want a cleaner URL such as `https://smart.yourdomain.com`.

1. Go to `Control Panel > Login Portal > Advanced > Reverse Proxy`.
2. Create a rule for the frontend:
   - Source: `https://smart.yourdomain.com`
   - Destination host: `127.0.0.1`
   - Destination port: `4200`
3. If you publish the backend separately, create another rule such as `https://api.yourdomain.com` to port `3000`.
4. Update `.env`:

```env
FRONTEND_ORIGIN=https://smart.yourdomain.com
FRONTEND_API_URL=/api
```

If you route the frontend and backend through the same frontend host, keep `FRONTEND_API_URL=/api`.

## 6. Recommended NAS settings

1. Reserve a fixed LAN IP for the NAS in your router.
2. Do not expose MySQL to the internet.
3. Keep `DB_HOST_PORT=127.0.0.1:3306` unless you have a specific admin need.
4. Use strong secrets and store the real `.env` outside backups you share publicly.
5. If memory is tight, do not enable extra tools unless needed.

## 7. Update the project later

```bash
docker compose down
docker compose up -d --build
```

## 8. Common problems

- `frontend` opens but login fails: verify `FRONTEND_ORIGIN` exactly matches the browser URL.
- `backend` unhealthy: inspect `docker compose logs -f backend` and confirm the database is healthy first.
- `db` fails on first boot: confirm the passwords in `.env` are set and that the volume is writable.
- Reverse proxy errors: confirm DSM points to port `4200`, not directly to container port `80`.