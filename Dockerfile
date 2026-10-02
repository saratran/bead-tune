# Bead Pattern Maker — production image.
# Bun bundles the frontend (index.html → React app) when the server starts.
FROM oven/bun:1.2-slim

WORKDIR /app

# Runtime dependencies only (react, react-dom, jspdf); dev/test tooling is skipped.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY server.ts index.html tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production \
    PORT=3000
EXPOSE 3000

USER bun

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://localhost:' + (process.env.PORT || 3000)).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["bun", "server.ts"]
