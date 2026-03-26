# ─── Stage 1: Build WASM engine ──────────────────────────────────────────────
FROM rust:1.82-slim AS wasm-builder

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
RUN rustup target add wasm32-unknown-unknown

WORKDIR /app
COPY Cargo.toml ./
COPY wasm-engine/ ./wasm-engine/
# Stub server so workspace resolves
COPY server/Cargo.toml ./server/Cargo.toml
RUN mkdir -p server/src && echo 'fn main(){}' > server/src/main.rs

RUN wasm-pack build wasm-engine --target web --out-dir /wasm-out --release

# ─── Stage 2: Build Axum server ──────────────────────────────────────────────
FROM rust:1.82-slim AS server-builder

WORKDIR /app
COPY Cargo.toml ./
COPY server/ ./server/
# Stub wasm-engine so workspace resolves
COPY wasm-engine/Cargo.toml ./wasm-engine/Cargo.toml
RUN mkdir -p wasm-engine/src && echo 'pub fn greet(_: &str) -> String { String::new() }' > wasm-engine/src/lib.rs

RUN cd server && cargo build --release

# ─── Stage 3: Final minimal image ────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=server-builder /app/server/target/release/server ./server
COPY --from=wasm-builder   /wasm-out                          ./static/wasm
COPY templates/  ./templates/
COPY static/     ./static/
# Overwrite static/wasm with the freshly compiled output
COPY --from=wasm-builder /wasm-out ./static/wasm

EXPOSE 3000
ENV RUST_LOG=info

CMD ["./server"]
