#!/usr/bin/env bash
# Runs `swift test` in every local package, in dependency order. Under the Command Line Tools
# (no Xcode) the Swift Testing macros live in a folder SwiftPM does not search, so it is passed in.
# It selects and prints the Xcode CI pins first (toolchain.sh, which holds the local command matching CI).
# Usage: apps/ios/scripts/test-packages.sh [package ...]
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=toolchain.sh
source scripts/toolchain.sh
cd Packages
packages=("$@")
if [ ${#packages[@]} -eq 0 ]; then
  packages=(CommishAPI CommishDesign CommishCore Features/LeagueHome Features/Shell Features/Start Features/Matchup Features/Board Features/Waivers Features/Player Features/Trades Features/Rankings Features/Record Features/Account Features/Reference Features/Companion Features/MockRoom Features/Sheet)
fi
flags=()
developer_dir="$(xcode-select -p)"
if [[ "$developer_dir" == *CommandLineTools* ]]; then
  flags=(-Xswiftc -plugin-path -Xswiftc "$developer_dir/usr/lib/swift/host/plugins/testing")
fi
for package in "${packages[@]}"; do
  echo "== swift test: $package"
  (cd "$package" && swift test ${flags[@]+"${flags[@]}"})
done
