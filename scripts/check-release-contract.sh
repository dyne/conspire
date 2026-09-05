#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly root
readonly makefile="$root/GNUmakefile"
readonly cmakefile="$root/server/CMakeLists.txt"
readonly workflow="$root/.github/workflows/main.yml"
readonly vendor_builder="$root/scripts/build-vendored-oatpp.sh"

# `cmake -S server -B build` writes this executable at build/conspire-exe.
# Keep the release artifact copy synchronized while statically verifying its
# vendored oatpp prefix and musl-toolchain inputs.
rg -q 'add_executable\(conspire-exe src/App\.cpp\)' "$cmakefile"
test -x "$vendor_builder"
rg -q 'vendor/oatpp' "$vendor_builder"
rg -q 'oatpp-websocket oatpp-openssl' "$vendor_builder"
rg -q 'Build vendored oatpp 1.4 prefix' "$workflow"
rg -q 'run: ./scripts/build-vendored-oatpp.sh' "$workflow"
if rg -q 'CONSPIRE_OATPP_1_4_PREFIX' "$workflow"; then
  printf '%s\n' 'release workflow still depends on an external oatpp prefix' >&2
  exit 1
fi
preview="$(make --no-print-directory -C "$root" -n conspire \
  CONSPIRE_DEPS_PREFIX=/verified/oatpp-1.4-prefix VERSION=contract-test)"
grep -Fq './scripts/build-vendored-oatpp.sh' <<<"$preview"
grep -Fq 'ninja -C "build" conspire-exe' <<<"$preview"
grep -Fq 'install -m 0755 "build/conspire-exe" "conspire-x86_64.new"' <<<"$preview"
grep -Fq 'mv "conspire-x86_64.new" "conspire-x86_64"' <<<"$preview"
if grep -Fq 'CONSPIRE_DEPS_PREFIX must name' "$makefile"; then
  printf '%s\n' 'default Make target still rejects the vendored dependency prefix' >&2
  exit 1
fi
if grep -Fq 'canchat-exe' "$makefile"; then
  printf '%s\n' 'release Make target still refers to the retired canchat-exe artifact' >&2
  exit 1
fi
printf '%s\n' 'release CMake target and artifact-copy contract verified'
