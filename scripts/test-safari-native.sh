#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/aside-native-tests.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT
xcrun swiftc -parse-as-library -module-cache-path "$test_dir/modules" safari/TranslationLanguages.swift safari/SafariWebExtensionHandler.swift tests/safari-native.swift -o "$test_dir/native-tests"
"$test_dir/native-tests"
