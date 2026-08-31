#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly root
shellcheck "$root"/scripts/*.sh
cppcheck --enable=warning,performance,portability --error-exitcode=1 \
  --suppress=missingIncludeSystem \
  "$root/server/src/utils/ConfigValidation.hpp" \
  "$root/server/src/utils/ServerBoundaries.hpp"
# Full server analysis needs the externally supplied compatible oatpp 1.4
# prefix. It is deliberately not replaced with public oatpp 1.3.x.
printf '%s\n' 'shellcheck and cppcheck passed'
