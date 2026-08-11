#!/bin/sh
# In stdio mode there is no HTTP listener to probe, so report healthy rather than marking
# every `docker run -i ... --stdio` container unhealthy.
#
# The flag has to be read from PID 1's command line, not from "$@": HEALTHCHECK runs this
# script with its own (empty) arguments, so the container's `--stdio` never reaches it.
# Only the MCP_TRANSPORT env var would be visible, and `docker run -i ... --stdio` leaves
# that at the image default of "http".
if tr '\0' ' ' < /proc/1/cmdline 2>/dev/null | grep -q -- '--stdio'; then
  exit 0
fi
case "${MCP_TRANSPORT:-http}" in
  stdio) exit 0 ;;
esac
wget --quiet --tries=1 --spider "http://127.0.0.1:${MCP_PORT:-3000}/health" || exit 1
