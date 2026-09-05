#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly root
readonly prefix="${CONSPIRE_DEPS_PREFIX:-}"
readonly context="$root/dist/container-context"
readonly build_dir="$root/dist/container-build"
readonly tag="${CONSPIRE_CONTAINER_TAG:-conspire:local}"

if [[ -z "$prefix" || ! -d "$prefix" ]]; then
  printf '%s\n' 'CONSPIRE_DEPS_PREFIX must name a verified compatible oatpp 1.4 prefix; public oatpp 1.3 is intentionally not substituted.' >&2
  exit 2
fi
command -v docker >/dev/null
rm -rf "$context" "$build_dir"
mkdir -p "$context"

cmake -S "$root" -B "$build_dir" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF \
  -DCONSPIRE_DEPS_PREFIX="$prefix"
cmake --build "$build_dir" --target conspire-exe
install -m 0755 "$build_dir/server/conspire-exe" "$context/conspire"
docker build --pull=false --tag "$tag" --file "$root/Dockerfile" "$context"
printf '%s\n' "built deterministic runtime context and image: $tag"
