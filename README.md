# imgpact

**Free, browser-based image & GIF tools.** No upload limits. No signup. All processing runs client-side via Rust compiled to WebAssembly.

## Features

- **GIF Tools**: GIF Maker, GIF Editor, GIF Split, GIF Analyzer, Video→GIF, GIF→MP4/WebM/MOV
- **Image Tools**: Crop, Resize, Optimize (batch), Effects, Transform, Add Text
- **Format Converters**: WebP, APNG, AVIF, JXL, SVG ↔ GIF

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Rust · Axum · Tera templates |
| Image processing | Rust → WebAssembly (wasm-pack + wasm-bindgen) |
| Video processing | FFmpeg.wasm (loaded from CDN) |
| Frontend | Plain HTML + CSS + vanilla JS (no framework) |
| Deployment | Docker + Nginx + Let's Encrypt |

## Local Development

### Prerequisites

- [Rust](https://rustup.rs/) (stable toolchain)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

### Run (dev mode)

```bash
# From project root:
./build.sh dev
# Server starts at http://localhost:3000
```

Or without building WASM first (image tools won't work, server still loads):
```bash
cd server && cargo run
```

## Production Deployment

### Docker (recommended)

```bash
docker compose up -d
```

For SSL, first obtain a certificate:
```bash
docker compose run --rm certbot certonly --webroot \
  --webroot-path=/var/www/certbot \
  -d imgpact.com -d www.imgpact.com
```

### Bare metal (systemd)

```bash
# Build
./build.sh prod

# Install
sudo cp server/target/release/server /opt/imgpact/
sudo cp -r templates static /opt/imgpact/
sudo cp imgpact.service /etc/systemd/system/
sudo systemctl enable --now imgpact
```

### Nginx (reverse proxy)

Copy `nginx/nginx.conf` to `/etc/nginx/conf.d/imgpact.conf` and reload nginx.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RUST_LOG` | `info` | Log level: `error`, `warn`, `info`, `debug`, `trace` |
| `PORT` | `3000` | Listening port (note: currently hardcoded in main.rs — set in systemd unit) |

## Project Structure

```
imgpact/
├── Cargo.toml              # Workspace
├── server/                 # Axum web server
│   └── src/main.rs
├── wasm-engine/            # Rust → WASM image processing
│   └── src/
│       ├── lib.rs          # Entry point + encode_image helper
│       ├── crop.rs
│       ├── resize.rs
│       ├── transform.rs
│       ├── convert.rs
│       ├── optimize.rs
│       ├── effects.rs
│       ├── gif_engine.rs
│       └── text.rs
├── templates/              # Tera HTML templates
│   ├── base.html
│   ├── index.html
│   └── tools/
├── static/
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js
│   │   ├── tool-common.js
│   │   ├── wasm-bridge.js
│   │   ├── ffmpeg-bridge.js
│   │   └── tools/
│   └── wasm/               # Compiled WASM (git-ignored, built by build.sh)
├── nginx/nginx.conf
├── Dockerfile
├── docker-compose.yml
├── build.sh
└── imgpact.service
```

## License

MIT
