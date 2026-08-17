FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 8080

# Vite embeds Supabase/model configuration at build time, so build after
# Zeabur injects the service environment and then serve the SPA on PORT.
CMD ["sh", "-lc", "npm run build:deploy && npm run preview -- --host 0.0.0.0 --port ${PORT:-8080}"]
