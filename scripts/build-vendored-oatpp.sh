#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly root
readonly prefix="${CONSPIRE_DEPS_PREFIX:-$root/build/deps}"
readonly build_root="${CONSPIRE_VENDOR_BUILD_DIR:-$root/build/vendor-oatpp}"

if [[ -n "${CMAKE_TOOLCHAIN_FILE:-}" && ! -f "${CMAKE_TOOLCHAIN_FILE}" ]]; then
  printf '%s\n' "CMAKE_TOOLCHAIN_FILE does not exist: ${CMAKE_TOOLCHAIN_FILE}" >&2
  exit 2
fi

common_args=(
  -G Ninja
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_INSTALL_PREFIX="$prefix"
  -DBUILD_SHARED_LIBS=OFF
  -DOATPP_BUILD_TESTS=OFF
)
if [[ -n "${CMAKE_TOOLCHAIN_FILE:-}" ]]; then
  common_args+=("-DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}")
fi
if command -v ccache >/dev/null; then
  common_args+=(-DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_CXX_COMPILER_LAUNCHER=ccache)
fi

cmake -S "$root/vendor/oatpp" -B "$build_root/oatpp" "${common_args[@]}"
cmake --build "$build_root/oatpp" --parallel 2
cmake --install "$build_root/oatpp"

for module in oatpp-websocket oatpp-openssl; do
  cmake -S "$root/vendor/$module" -B "$build_root/$module" "${common_args[@]}" \
    "-DCMAKE_PREFIX_PATH=$prefix"
  cmake --build "$build_root/$module" --parallel 2
  cmake --install "$build_root/$module"
done
