#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <package-zip>"
  exit 1
fi

PACKAGE_ZIP="$1"
WORK_DIR="${2:-$(pwd)/.smoke-workdir}"

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
unzip -q "$PACKAGE_ZIP" -d "$WORK_DIR"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-connectsphere}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
JWT_SECRET="${JWT_SECRET:-ci-test-secret}"
PORT="${PORT:-3000}"

export DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD JWT_SECRET PORT

npm --prefix "$WORK_DIR/backend" ci
npm --prefix "$WORK_DIR/frontend" ci
npm --prefix "$WORK_DIR/backend" run init-db

BACKEND_LOG="$WORK_DIR/backend-smoke.log"
FRONTEND_LOG="$WORK_DIR/frontend-smoke.log"

node "$WORK_DIR/backend/src/index.js" >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

npm --prefix "$WORK_DIR/frontend" run preview -- --host 127.0.0.1 --port 4173 --strictPort >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

cleanup() {
  if kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  wait "$BACKEND_PID" 2>/dev/null || true
  wait "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT

wait_for_url() {
  local url="$1"
  local retries="${2:-45}"
  local sleep_seconds="${3:-2}"
  for _ in $(seq 1 "$retries"); do
    if curl -fsS "$url" >/dev/null; then
      return 0
    fi
    sleep "$sleep_seconds"
  done
  return 1
}

wait_for_url "http://127.0.0.1:${PORT}/api/health"
wait_for_url "http://127.0.0.1:4173"

curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null
curl -fsS "http://127.0.0.1:4173/login" | grep -q "ConnectSphere"

echo "Smoke checks passed for packaged backend/frontend."
