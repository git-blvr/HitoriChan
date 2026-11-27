# ── Stage 1: compile the Rust native module ──────────────────────────────────
FROM rust:1-bookworm AS native
WORKDIR /build/native
COPY native/Cargo.toml native/Cargo.lock native/build.rs ./
COPY native/src ./src
RUN cargo build --release

# ── Stage 2: install production node deps ────────────────────────────────────
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:24-bookworm-slim
WORKDIR /app

# fontconfig + fonts so @napi-rs/canvas can render text (GIF maker, rank cards)
RUN apt-get update \
 && apt-get install -y --no-install-recommends fontconfig fonts-liberation fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY index.js ./
COPY src ./src
COPY --from=native /build/native/target/release/libhitori_native.so ./native/hitori_native.node

RUN mkdir -p data && chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 12948

CMD ["node", "index.js"]
