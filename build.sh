#!/usr/bin/env bash
set -e

MODE="${1:-dev}"

echo "==> imgpact build mode: $MODE"

# Build WASM engine
echo "==> Building wasm-engine..."
if [ "$MODE" = "prod" ]; then
    cd wasm-engine && wasm-pack build --target web --out-dir ../static/wasm --release
else
    cd wasm-engine && wasm-pack build --target web --out-dir ../static/wasm --dev
fi
cd ..

# Clean up wasm-pack artifacts
rm -f static/wasm/.gitignore static/wasm/package.json static/wasm/README.md

echo "==> WASM built → static/wasm/"

# Start server (run from workspace root so templates/ and static/ resolve correctly)
echo "==> Starting server on port 3000..."
if [ "$MODE" = "prod" ]; then
    cargo run --release -p server
else
    RUST_LOG=debug cargo run -p server
fi
