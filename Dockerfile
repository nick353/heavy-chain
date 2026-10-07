FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .

ENV NODE_ENV=production
ENV VITE_CLOUDFLARE_API_ENABLED=true \
    VITE_CLOUDFLARE_API_BASE_URL=https://heavy-chain-api.nichika2000823.workers.dev \
    VITE_MEDIA_PROVIDER_ORDER=cloudflare_r2 \
    VITE_MEDIA_GATEWAY_URL=https://heavy-chain-api.nichika2000823.workers.dev \
    VITE_GENERATION_PROVIDER=workers_ai \
    PUBLIC_URL=https://heavy-chain.zeabur.app

# Public Vite configuration is embedded once in the image; no build is done at startup.
# Self-hosted reference assets arrive as one tar (see docs/parity/release.sh).
RUN if [ -f public/lightchain-assets-bundle.tar ]; then tar -xf public/lightchain-assets-bundle.tar -C public && rm public/lightchain-assets-bundle.tar; fi \
    && npm run build \
    && test -s dist/lightchain-assets/fitting-models/Male/1.webp \
    && test -s dist/assets/silueta.onnx \
    && echo heavy-chain-model-asset-ready:$(wc -c < dist/assets/silueta.onnx)

EXPOSE 8080
CMD ["node", "scripts/serve-zeabur.mjs"]
