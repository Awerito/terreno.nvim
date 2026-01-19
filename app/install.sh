#!/usr/bin/env bash

set -o nounset
set -o errexit

cd "$(dirname "$0")"

echo "Installing dependencies..."
npm install

echo "Building client..."
npm run build

echo "Terreno installed successfully!"
