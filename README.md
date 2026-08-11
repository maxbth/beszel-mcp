# beszel-mcp

[![CI](https://github.com/maxbth/beszel-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/maxbth/beszel-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)

A read-only [MCP](https://modelcontextprotocol.io) server for a
[Beszel](https://beszel.dev) monitoring hub. Twelve tools let an agent answer
questions about your servers — load, containers, services, disk health, alerts —
without knowing anything about Beszel's API.

An independent project, not affiliated with or endorsed by the Beszel maintainers.

## Quick start

```bash
docker run -p 3000:3000 \
  -e BESZEL_URL=https://beszel.example.com \
  -e BESZEL_EMAIL=you@example.com \
  -e BESZEL_PASSWORD=your-password \
  -e MCP_AUTH_TOKEN=some-long-random-string \
  ghcr.io/maxbth/beszel-mcp
```

The MCP endpoint is `POST http://localhost:3000/mcp` (Streamable HTTP).

### stdio

For local clients that speak stdio:

```bash
docker run -i --rm \
  -e BESZEL_URL=https://beszel.example.com \
  -e BESZEL_EMAIL=you@example.com \
  -e BESZEL_PASSWORD=your-password \
  ghcr.io/maxbth/beszel-mcp --stdio
```

Wired into an MCP client — Claude Desktop, Claude Code, or anything else that launches a
subprocess. `-i` is required (the client talks to the container's stdin) and `--rm` keeps a
container from being left behind on every restart:

```json
{
  "mcpServers": {
    "beszel": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "BESZEL_URL",
        "-e", "BESZEL_EMAIL",
        "-e", "BESZEL_PASSWORD",
        "ghcr.io/maxbth/beszel-mcp", "--stdio"
      ],
      "env": {
        "BESZEL_URL": "https://beszel.example.com",
        "BESZEL_EMAIL": "you@example.com",
        "BESZEL_PASSWORD": "your-password"
      }
    }
  }
}
```

`MCP_AUTH_TOKEN` has no role here: there is no port to reach, so the only thing that can talk
to the server is the process that spawned it.

### Image tags

| Tag | Points at |
|---|---|
| `latest`, `1.2.3`, `1.2`, `1` | the most recent tagged release |
| `dev` | the current tip of `main`, rebuilt on every push |

`dev` moves. It is the right tag for trying unreleased changes and the wrong one
for anything you depend on, since the digest behind it changes without warning.
Pull a version tag for that.

## Tools

| Tool | What it answers |
|---|---|
| `get_hub_info` | Can I reach the hub, and what is it running? |
| `list_systems` | What machines exist and how are they doing right now? |
| `get_system` | Full hardware and current state for one machine |
| `get_system_metrics` | How has this machine behaved over the last hour/day/week? |
| `list_containers` | What containers are running, and are any unhealthy? |
| `get_container_metrics` | Which container is eating the CPU? |
| `get_container_logs` | What is this container saying? |
| `list_services` | Which systemd units are failed? |
| `get_service_details` | Why is this unit unhappy? |
| `list_smart_devices` | Is any disk dying? |
| `list_alerts` | What alerts are configured, and which are firing? |
| `get_alert_history` | Is this problem recurring? |

Every tool is read-only. This server never writes to your hub.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `BESZEL_URL` | — | **required** |
| `BESZEL_EMAIL` / `BESZEL_PASSWORD` | — | required unless `BESZEL_TOKEN` |
| `BESZEL_TOKEN` | — | skips login |
| `BESZEL_SUPERUSER` | `false` | authenticate against `_superusers` |
| `BESZEL_TIMEOUT_MS` | `15000` | per-request timeout |
| `MCP_TRANSPORT` | `http` | `http` or `stdio`; `--stdio` overrides |
| `MCP_HOST` | `127.0.0.1` | the image sets `0.0.0.0` |
| `MCP_PORT` | `3000` | |
| `MCP_AUTH_TOKEN` | unset | when set, a matching bearer token is required |
| `MCP_ALLOWED_ORIGINS` | empty | comma-separated **hostnames** (not full origins), added to the localhost defaults on a localhost bind |
| `LOG_LEVEL` | `info` | |

## Securing the endpoint with `MCP_AUTH_TOKEN`

Set `MCP_AUTH_TOKEN` and every request to `/mcp` must carry a matching
`Authorization: Bearer` header. Leave it unset and the endpoint is open to anything that can
reach the port. There is no default value and no built-in fallback — an unset token means no
authentication, not a weak one.

**1. Generate one.** Any long random string works; these produce 32 bytes of base64:

```bash
openssl rand -base64 32
```

**2. Give it to the server.** Prefer a file over an inline `-e`, which lands in your shell
history and in `docker inspect` output:

```bash
echo "MCP_AUTH_TOKEN=$(openssl rand -base64 32)" >> .env
docker run -p 3000:3000 --env-file .env ghcr.io/maxbth/beszel-mcp
```

**3. Give it to the client.** In an MCP client's server config:

```json
{
  "mcpServers": {
    "beszel": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": {"Authorization": "Bearer PASTE_THE_TOKEN_HERE"}
    }
  }
}
```

To check it by hand — the first should return 401, the second should not:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mcp.example.com/mcp
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mcp.example.com/mcp -H "Authorization: Bearer $MCP_AUTH_TOKEN"
```

Comparison is constant-time, and the token is never written to a log line or an error
message. To rotate it, change the value and restart: there is no session state, so nothing
survives the restart and every client simply presents the new token on its next request.

`MCP_AUTH_TOKEN` protects `/mcp` only — see below for why `/health` is deliberately open.

## Health checks

`GET /health` returns `200 {"status":"ok"}` and is reachable **without a bearer token, from
outside the container, through a reverse proxy**. It is exempt from the bearer check and from
the `Host`/`Origin` validation that guards `/mcp`, so an uptime monitor or tunnel — Pangolin,
Traefik, a Kubernetes liveness probe, the image's own `HEALTHCHECK` — can reach it without
being configured as a browser origin or preserving a particular `Host` header.

That exemption is safe because the route has nothing to protect: it returns no monitoring
data, no configuration and no credential, and it changes nothing. `Host`/`Origin` validation
exists to stop a malicious web page using a victim's browser to read data from a server on
their network — and there is no data here to read. Anyone who reaches `/health` learns only
that something is listening, which the TCP handshake already told them.

`/mcp` keeps every protection. A valid bearer token still does not buy past `Origin`
validation, and vice versa.

For Pangolin specifically, point the health check at `/health` on the same port you expose:

```
Health check path: /health
Expected status:   200
```

### A note on exposure

The image binds `0.0.0.0` so the container is reachable from outside itself. A wildcard
bind gets no automatic `Host`-header validation, so **set `MCP_AUTH_TOKEN`** — otherwise
anything that can reach the port can read every monitored machine, container and disk, and
fetch container logs. The server warns on stderr when you do not. `Origin` validation is
always on: on a wildcard bind with `MCP_ALLOWED_ORIGINS` empty, browser requests are rejected
outright and only non-browser clients (which send no `Origin`) get through.

On a localhost bind (`127.0.0.1`, `localhost`, `::1` — the default outside the image) the
localhost hostnames `localhost`, `127.0.0.1` and `[::1]` are allowed on top of whatever
`MCP_ALLOWED_ORIGINS` lists, so browser-hosted clients such as the MCP Inspector work with no
configuration. Non-localhost origins are still rejected.

### A note on visibility

Beszel scopes systems per user. If tools report no systems, the configured
account is probably not a member of them — either add it to each system, or run
the hub with `SHARE_ALL_SYSTEMS=true`.

`get_container_logs` additionally requires the hub to have container details
enabled (it is, unless the hub sets `CONTAINER_DETAILS=false`).

## Hub compatibility

Built and tested against **Beszel 0.19**. An older hub still works: 0.19 moved hostname, kernel,
CPU model, core/thread counts, OS and podman out of `systems.info` into a `system_details`
collection, so `list_systems` joins it and falls back to the legacy blob when the collection
answers 404. Decoding likewise accepts both the current byte fields and the deprecated MB/s pairs.
Nothing needs configuring either way.

## Development

Requires [Bun](https://bun.sh) 1.3+.

```bash
bun install
bun test
bun run typecheck   # Bun does not typecheck; this is what does
bun run lint:check
bun run dev
```

Issues and pull requests are welcome. Run those three commands before opening a PR — CI runs
exactly the same gate, plus a multi-arch Docker build, and fails on any lint warning. Tests are
colocated with what they test (`src/config.ts` / `src/config.test.ts`) and every tool is
read-only by contract, so a change that writes to the hub will not be accepted.

## License

[MIT](LICENSE.md) © Maxime Bertheau
