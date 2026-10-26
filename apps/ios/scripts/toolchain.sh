#!/usr/bin/env bash
# Sourced by test-packages.sh: selects the Xcode CI pins (XCODE_VERSION in .github/workflows/ios.yml,
# the one place the version is written) when this Mac has it, and prints the toolchain a run used, so
# a local run says whether it matches the Xcode the snapshot references were recorded on.
#
# The local run that matches CI, once the pinned Xcode is installed (`xcodes install 26.6` puts it at
# /Applications/Xcode-26.6.0.app; GitHub's image names it /Applications/Xcode_26.6.app):
#   zsh apps/ios/scripts/test-packages.sh      # picks the pinned Xcode itself
#   zsh apps/ios/scripts/lint.sh
#   export DEVELOPER_DIR=/Applications/Xcode-26.6.0.app/Contents/Developer
#   cd apps/ios && xcodegen generate
#   xcrun simctl create commish-local "iPhone 17 Pro"   # under the newest runtime that Xcode carries
#   xcodebuild -project Commish.xcodeproj -scheme Commish \
#     -destination "platform=iOS Simulator,name=commish-local" -skipPackagePluginValidation \
#     -skipMacroValidation CODE_SIGNING_ALLOWED=NO build test
# Without the pinned Xcode (in October 2026 this Mac carries Xcode 27.1 only, and GitHub's macos-26
# image stops at 26.6) a run uses the selected Xcode and says it differs: the view models and the copy
# guard still gate, while the snapshots compare against references recorded on CI's Xcode and can
# differ by the SDK's rendering. When Xcode 27 reaches GitHub's image, the bump is XCODE_VERSION in
# ios.yml plus a re-record there (workflow_dispatch with record_snapshots).
# Sourced from apps/ios/Packages (bash and zsh agree on the working folder, not on a sourced path).
workflow="../../../.github/workflows/ios.yml"
pinned="$(sed -n 's/^  XCODE_VERSION: "\(.*\)"$/\1/p' "$workflow")"
if [ -z "$pinned" ]; then
  echo "No XCODE_VERSION in $workflow." >&2
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
echo "== Toolchain: $local_xcode, $swift_version, rendering on macOS $(sw_vers -productVersion); CI pins Xcode $pinned"
if [ "$local_xcode" != "Xcode $pinned" ]; then
  echo "== Not CI's Xcode: the snapshots compare against references recorded on Xcode $pinned."
fi
