#!/bin/sh
# Builds the deployable site into dist/. Used by both hosts:
#   - Cloudflare Pages: build command `sh scripts/build.sh`, output directory `dist`
#   - GitHub Pages:     .github/workflows/pages.yml
#
# There is no bundler; the one thing the build does is stamp the commit into
# every asset URL. Without it, a browser mixes a fresh index.html with
# month-old cached modules and a deploy looks like it did nothing.
set -eu

SHA="${CF_PAGES_COMMIT_SHA:-${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo dev)}}"
SHA=$(printf '%s' "$SHA" | cut -c1-7)

rm -rf dist
mkdir dist
# Only what the site serves: no README, workflows, scripts or git metadata.
cp -R index.html unsubscribe.html auth.html manifest.webmanifest _headers LICENSE assets data src dist/

cd dist
sed -i "s|src=\"src/app.js\"|src=\"src/app.js?v=$SHA\"|" index.html
sed -i "s|href=\"assets/css/app.css\"|href=\"assets/css/app.css?v=$SHA\"|" index.html
sed -i "s|src=\"src/auth-return.js\"|src=\"src/auth-return.js?v=$SHA\"|" auth.html
sed -i "s|__BUILD__|$SHA|g" index.html
sed -i -E "s|(from '\./[A-Za-z0-9_-]+\.js)'|\1?v=$SHA'|g" src/*.js
sed -i "s|fetch('data/brokers.json')|fetch('data/brokers.json?v=$SHA')|" src/app.js

echo "--- built dist/ as $SHA ---"
grep -o 'src/app.js?v=[a-f0-9a-z]*' index.html
grep -ho "from '\./[a-z0-9-]*\.js?v=[a-f0-9a-z]*'" src/*.js | sort -u
