#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="${1:-$ROOT_DIR/.artifacts}"
if [[ "$OUTPUT_DIR" != /* ]]; then
  OUTPUT_DIR="$ROOT_DIR/$OUTPUT_DIR"
fi
PACKAGE_DIR="$OUTPUT_DIR/package-root"
PACKAGE_ZIP="$OUTPUT_DIR/connectsphere-package.zip"
SBOM_DIR="$OUTPUT_DIR/sbom"

rm -rf "$PACKAGE_DIR" "$PACKAGE_ZIP" "$SBOM_DIR"
mkdir -p "$PACKAGE_DIR" "$SBOM_DIR"

rsync -a \
  --exclude='node_modules' \
  --exclude='playwright-report' \
  --exclude='test-results' \
  --exclude='.DS_Store' \
  "$ROOT_DIR/backend" \
  "$ROOT_DIR/frontend" \
  "$ROOT_DIR/e2e" \
  "$ROOT_DIR/.env.example" \
  "$ROOT_DIR/README.md" \
  "$PACKAGE_DIR/"

(cd "$PACKAGE_DIR" && zip -qr "$PACKAGE_ZIP" .)

npm --prefix "$ROOT_DIR/backend" sbom --sbom-format cyclonedx --omit dev > "$SBOM_DIR/backend.cdx.json"
npm --prefix "$ROOT_DIR/frontend" sbom --sbom-format cyclonedx --omit dev > "$SBOM_DIR/frontend.cdx.json"
npm --prefix "$ROOT_DIR/e2e" sbom --sbom-format cyclonedx --omit dev > "$SBOM_DIR/e2e.cdx.json"

echo "Packaged artifact: $PACKAGE_ZIP"
echo "SBOM output: $SBOM_DIR"
