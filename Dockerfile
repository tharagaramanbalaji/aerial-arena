# Aerial Arena: one container serving the built game client + the authoritative match server
# (HTTP + WebSocket on the same port). Works on any host that supports long-lived WebSockets
# (Render, Railway, Fly.io, a VPS...). Not suitable for serverless/static-only hosts.
FROM node:22-slim

WORKDIR /app

# Install dependencies first (better layer caching): root + every workspace manifest.
COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/game-core/package.json packages/game-core/package.json
RUN npm ci

# Build the client into apps/client/dist (the server serves it as static files).
COPY . .
RUN npm run build -w apps/client

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
EXPOSE 8080

# Health check endpoint for platforms that support it: GET /health
CMD ["npm", "start"]
