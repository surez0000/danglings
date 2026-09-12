#!/bin/sh
# Regenerate the runtime bird asset from the raw Meshy export.
# Raw source (3ds/) is gitignored — too large for GitHub (>100MB).
# --simplify-error 0.0005 -> ~61k tris / 620KB. Use 0.01 for a ~4.5k-tri / 197KB variant.
npm_config_registry=https://registry.npmjs.org npx -y @gltf-transform/cli optimize \
  3ds/Blue_bird.glb public/companions/bluebird.glb \
  --compress meshopt --texture-compress webp --texture-size 1024 --simplify-error 0.0005
