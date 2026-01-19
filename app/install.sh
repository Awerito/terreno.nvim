#!/usr/bin/env bash

set -o nounset
set -o errexit

cd "$(dirname "$0")"

echo "Installing server dependencies..."
npm install

echo "Installing client dependencies..."
npm install --prefix client

echo "Building client..."
npm run build

echo "Terreno installed successfully!"
