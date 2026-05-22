#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

usage() {
  cat <<EOF
Usage:
  ./setup.sh init
  ./setup.sh install
  ./setup.sh up
  ./setup.sh down
  ./setup.sh backup-db <output.sql>
  ./setup.sh restore-db <input.sql>
EOF
}

cmd="${1:-}"

case "$cmd" in
  init)
    if [[ ! -f "$ROOT_DIR/.env" ]]; then
      cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
      echo "Created .env from .env.example"
    else
      echo ".env already exists"
    fi
    "$0" install
    ;;
  install)
    echo "Installing backend dependencies..."
    (cd "$BACKEND_DIR" && npm install)
    echo "Installing frontend dependencies..."
    (cd "$FRONTEND_DIR" && npm install)
    echo "Dependencies installed."
    ;;
  up)
    docker compose up --build
    ;;
  down)
    docker compose down
    ;;
  backup-db)
    out_file="${2:-}"
    if [[ -z "$out_file" ]]; then
      echo "Missing output path."
      usage
      exit 1
    fi
    mkdir -p "$(dirname "$out_file")"
    docker compose exec -T db sh -lc 'mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' > "$out_file"
    echo "Database backup saved to $out_file"
    ;;
  restore-db)
    in_file="${2:-}"
    if [[ -z "$in_file" || ! -f "$in_file" ]]; then
      echo "Input file not found."
      usage
      exit 1
    fi
    docker compose exec -T db sh -lc 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < "$in_file"
    echo "Database restored from $in_file"
    ;;
  *)
    usage
    ;;
esac
