#!/bin/bash
# Deploy ArtifactMap source files to bc-app
# Usage: bash /tmp/claude-0/Claude/tools/deploy-artifact-map.sh

SRC="/tmp/claude-0/Claude/features/ArtifactMap"
DST="/root/repos/bc/packages/bc-app/src/utils/ArtifactMap"

cp "$SRC/getArtifactMapData.ts" "$DST/getArtifactMapData.ts" && echo "✓ getArtifactMapData.ts"
cp "$SRC/ArtifactMapEngine.ts"  "$DST/ArtifactMapEngine.ts"  && echo "✓ ArtifactMapEngine.ts"
cp "$SRC/ArtifactMapOverlay.tsx" "$DST/ArtifactMapOverlay.tsx" && echo "✓ ArtifactMapOverlay.tsx"

echo "Deploy complete."
