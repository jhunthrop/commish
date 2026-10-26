#!/usr/bin/env bash
# Sourced by test-packages.sh and lint.sh from apps/ios (bash and zsh agree on the working folder, not
# on a sourced file's path): selects the Xcode CI pins (XCODE_VERSION in .github/workflows/ios.yml, the
# one place the version is written) when this Mac has it, and prints the toolchain a run used, so a
# local run says whether it matches the Xcode and the macOS the snapshot references were recorded on.
#
# The local run that matches CI, once the pinned Xcode is installed (`xcodes install 26.6` puts it at
# /Applications/Xcode-26.6.0.app; GitHub's image names it /Applications/Xcode_26.6.app):
#   zsh apps/ios/scripts/test-packages.sh      # picks the pinned Xcode itself
#   zsh apps/ios/scripts/lint.sh
#   export DEVELOPER_DIR=/Applications/Xcode-26.6.0.app/Contents/Developer
#   cd apps/ios && xcodegen generate
#   xcodebuild -downloadPlatform iOS                     # a fresh Xcode carries no simulator runtime
#   xcrun simctl create commish-local "iPhone 17 Pro"   # under the newest runtime that Xcode carries
#   xcodebuild -project Commish.xcodeproj -scheme Commish \
#     -destination "platform=iOS Simulator,name=commish-local" -skipPackagePluginValidation \
#     -skipMacroValidation CODE_SIGNING_ALLOWED=NO build test
# The packages need Swift tools 6.3: the first Xcode shipping Swift 6.3 or later (26.6 ships 6.3.3).
# The package snapshots render on the host macOS through ImageRenderer, so they follow the macOS as
# well as the Xcode: SNAPSHOT_MACOS in ios.yml names the macOS the references were recorded on.
# Without the pinned Xcode (in October 2026 this Mac carries Xcode 27.1 only, and GitHub's macos-26
# image stops at 26.6) a run uses the selected Xcode and says it differs: the view models and the copy
# guard still gate, while the snapshots compare against references recorded on CI and can differ by
# the SDK's or the macOS's rendering. When Xcode 27 reaches GitHub's image, the bump is XCODE_VERSION
# in ios.yml plus a re-record there (workflow_dispatch with record_snapshots).
#
# Convention while the pin is Xcode 26.6: pass a closure literal to Binding(set:), as in
# `Binding(get: { query }, set: { find($0) })`, never a function value; Swift 6.3.3 crashes in IRGen
# on the thunk from a @MainActor function value to the setter's @isolated(any) @Sendable type.
workflow="../../.github/workflows/ios.yml"
pinned="$(sed -n 's/^  XCODE_VERSION: "\(.*\)"$/\1/p' "$workflow")"
recorded_macos="$(sed -n 's/^  SNAPSHOT_MACOS: "\(.*\)"$/\1/p' "$workflow")"
if [ -z "$pinned" ] || [ -z "$recorded_macos" ]; then
  echo "No XCODE_VERSION or SNAPSHOT_MACOS (quoted) in $workflow." >&2
  exit 1
fi
if [ -z "${DEVELOPER_DIR:-}" ]; then
  for candidate in "/Applications/Xcode_$pinned.app" "/Applications/Xcode-$pinned.app" "/Applications/Xcode-$pinned.0.app"; do
    if [ -d "$candidate" ]; then
      export DEVELOPER_DIR="$candidate/Contents/Developer"
      break
    fi
  done
fi
if [[ "$(xcode-select -p)" == *CommandLineTools* ]]; then
  local_xcode="Command Line Tools"
else
  # Read whole, then cut: xcodebuild aborts on a pipe a reader such as head closes early.
  local_xcode="$(xcodebuild -version)"
  local_xcode="${local_xcode%%$'\n'*}"
fi
swift_version="$(swift --version 2>&1 | grep -o 'Swift version [0-9.]*')"
local_macos="$(sw_vers -productVersion)"
echo "== Toolchain: $local_xcode, $swift_version, rendering on macOS $local_macos;" \
  "CI pins Xcode $pinned, references recorded on macOS $recorded_macos"
if [ "$local_xcode" != "Xcode $pinned" ]; then
  echo "== Not CI's Xcode: the snapshots compare against references recorded on Xcode $pinned."
fi
# major.minor of the host against the recorded one: point releases keep the drawing.
local_macos_minor="$(echo "$local_macos" | cut -d. -f1-2)"
if [ "$local_macos_minor" != "$recorded_macos" ]; then
  echo "== Not CI's macOS: the snapshots compare against references recorded on macOS $recorded_macos."
fi
