#!/usr/bin/env bash
# Restart the imgpact server (recompile + relaunch)
set -e

echo "==> Stopping existing server..."
pkill -f "server.exe" 2>/dev/null || pkill -f "target.*server" 2>/dev/null || true

echo "==> Building server..."
cargo build --release -p server

echo "==> Starting server on port 3000..."
RUST_LOG=info cargo run --release -p server
