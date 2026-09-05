#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly root
readonly dockerfile="$root/Dockerfile"
rg -q '^USER conspire:conspire$' "$dockerfile"
rg -q 'TLS_FILE_PRIVATE_KEY=/run/certs/privkey.pem' "$dockerfile"
rg -q 'TLS_FILE_CERT_CHAIN=/run/certs/fullchain.pem' "$dockerfile"
rg -q '^ENTRYPOINT \["/app/conspire", "--tls"\]$' "$dockerfile"
if rg -qi 'newkey|privkey\.pem.*COPY|libressl-dev|cmake|ninja|g\+\+' "$dockerfile"; then
  printf '%s\n' 'runtime Dockerfile contains a key-generation, key-copy, or build-tool pattern' >&2
  exit 1
fi
if rg -q '^COPY .*front' "$dockerfile"; then
  printf '%s\n' 'runtime image still depends on external frontend assets' >&2
  exit 1
fi
if [[ "${1:-}" != '--verify-only' ]]; then
  "$root/scripts/build-container.sh"
  printf '%s\n' 'Image built from the verified CMake context; run with mounted operator certificates before network smoke.'
  exit 0
fi
printf '%s\n' 'Docker runtime contract verified. Full build/run smoke requires a verified compatible oatpp 1.4 prefix; public oatpp 1.3 is intentionally not substituted.'
