FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN bun build src/index.ts --target=bun --outdir dist --minify

FROM oven/bun:1-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache wget
COPY --from=builder /app/dist ./dist
COPY docker-healthcheck.sh /usr/local/bin/healthcheck
RUN chmod +x /usr/local/bin/healthcheck

# Bind to all interfaces: a container binding 127.0.0.1 is unreachable from outside it.
ENV MCP_HOST=0.0.0.0 \
    MCP_PORT=3000 \
    MCP_TRANSPORT=http

EXPOSE 3000
USER bun

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/usr/local/bin/healthcheck"]

# ENTRYPOINT is the binary and CMD holds default args, so `docker run -i ... --stdio`
# replaces the args and switches transport without overriding the entrypoint.
ENTRYPOINT ["bun", "run", "/app/dist/index.js"]
CMD []
