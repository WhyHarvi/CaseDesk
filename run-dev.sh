#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"

cleanup() {
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi

  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "Frontend dependencies are missing. Run 'cd frontend && npm install' first."
  exit 1
fi

if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
  echo "Backend dependencies are missing. Run 'cd backend && npm install' first."
  exit 1
fi

echo "Starting CaseDesk backend on http://localhost:5000 ..."
(cd "$BACKEND_DIR" && npm run dev) &
BACKEND_PID=$!

echo "Starting CaseDesk frontend on http://localhost:5173 ..."
(cd "$FRONTEND_DIR" && npm run dev) &
FRONTEND_PID=$!

wait "$BACKEND_PID" "$FRONTEND_PID"
