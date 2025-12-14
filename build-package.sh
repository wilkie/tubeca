#!/bin/bash
# Build Arch Linux package for Tubeca
#
# Usage: ./build-package.sh
#
# This script builds a pacman package that can be installed with:
#   sudo pacman -U tubeca-*.pkg.tar.zst

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if running on Arch
if ! command -v makepkg &> /dev/null; then
    echo "Error: makepkg not found. This script requires Arch Linux."
    exit 1
fi

# Check for required tools
if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm not found. Install with: sudo pacman -S pnpm"
    exit 1
fi

echo "Building Tubeca package..."
echo ""

# Clean previous builds
rm -rf src pkg *.pkg.tar.zst *.pkg.tar.xz 2>/dev/null || true

# Build the package
makepkg -sf

echo ""
echo "Package built successfully!"
echo ""
echo "Install with:"
echo "  sudo pacman -U tubeca-*.pkg.tar.zst"
echo ""
