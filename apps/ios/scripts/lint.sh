#!/usr/bin/env bash
# The iOS style gates: SwiftFormat in lint mode and SwiftLint strict. Under the Command Line Tools
# SwiftLint finds SourceKit in the tools' own lib folder.
set -euo pipefail
cd "$(dirname "$0")/.."
# SwiftLint's SourceKit comes from the selected Xcode: the pinned one when this Mac has it, named.
# shellcheck source=toolchain.sh
source scripts/toolchain.sh
swiftformat --lint .
developer_dir="$(xcode-select -p)"
if [[ "$developer_dir" == *CommandLineTools* ]]; then
  export DYLD_FRAMEWORK_PATH="$developer_dir/usr/lib"
fi
swiftlint lint --strict --quiet
