#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly root
readonly makefile="$root/GNUmakefile"
readonly cmakefile="$root/server/CMakeLists.txt"

# `cmake -S server -B build` writes this executable at build/conspire-exe.
# Keep the release artifact copy synchronized without requiring the unavailable
# compatible oatpp 1.4 prefix or the musl toolchain.
rg -q 'add_executable\(conspire-exe src/App\.cpp\)' "$cmakefile"
preview="$(make --no-print-directory -C "$root" -n conspire \
  CONSPIRE_DEPS_PREFIX=/verified/oatpp-1.4-prefix VERSION=contract-test)"
grep -Fq 'ninja -C build conspire-exe' <<<"$preview"
grep -Fq 'cp build/conspire-exe conspire-x86_64' <<<"$preview"
if grep -Fq 'canchat-exe' "$makefile"; then
  printf '%s\n' 'release Make target still refers to the retired canchat-exe artifact' >&2
  exit 1
fi
printf '%s\n' 'release CMake target and artifact-copy contract verified'
