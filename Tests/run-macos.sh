#!/bin/bash
# Build the actual app sources as an importable module, then exercise isolated test storage.
set -euo pipefail
app_dir="$(cd "$(dirname "$0")/.." && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/aoos-isolation.XXXXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
sdk="$(xcrun --sdk macosx --show-sdk-path)"
platform="$(uname -m)-apple-macosx13.0"
xcrun --sdk macosx swiftc -swift-version 5 -parse-as-library -sdk "$sdk" -target "$platform" \
    -emit-library -emit-module -enable-testing -module-name AoosGPTTestSubject \
    -emit-module-path "$work_dir/AoosGPTTestSubject.swiftmodule" \
    -o "$work_dir/libAoosGPTTestSubject.dylib" "$app_dir"/Sources/*.swift
xcrun --sdk macosx swiftc -swift-version 5 -parse-as-library -sdk "$sdk" -target "$platform" \
    -I "$work_dir" -L "$work_dir" -lAoosGPTTestSubject \
    -Xlinker -rpath -Xlinker "$work_dir" \
    "$app_dir/Tests/WorkspaceIsolationTests.swift" -o "$work_dir/verify"
"$work_dir/verify"
