#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly root
"$root/scripts/check-release-inputs.sh"
printf '%s\n' 'Dry run complete: no tags, releases, registries, or remote destinations were modified.'
