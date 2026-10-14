
# Build the React website
FROM node:24-alpine AS web-build
WORKDIR /web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./

# Use same-origin API requests
ENV VITE_API_BASE_URL=""
RUN npm run build


# Build the Fastify backend
FROM node:24-alpine AS server-build
WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/tsconfig.json ./
COPY server/src ./src

RUN npm run build && npm prune --omit=dev


# Production container
FROM node:24-alpine AS runtime

ENV NODE_ENV=production PORT=3001
WORKDIR /app

COPY --chown=node:node --from=server-build /app/package.json ./package.json
COPY --chown=node:node --from=server-build /app/node_modules ./node_modules
COPY --chown=node:node --from=server-build /app/dist ./dist

COPY --chown=node:node server/drizzle ./drizzle

# Copy React production files
COPY --chown=node:node --from=web-build /web/dist ./web-dist

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health/live" || exit 1

CMD ["node", "dist/server.js"]
