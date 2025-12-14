#!/bin/bash
set -e

# Tubeca systemd service uninstallation script
# Run as root or with sudo

INSTALL_DIR="/opt/tubeca"
SERVICE_USER="tubeca"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log_error "Please run as root or with sudo"
    exit 1
fi

echo ""
echo "This will uninstall Tubeca services."
echo ""
read -p "Are you sure you want to continue? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_info "Uninstallation cancelled."
    exit 0
fi

# Stop services
log_info "Stopping services..."
systemctl stop tubeca-backend.service 2>/dev/null || true
systemctl stop tubeca-frontend.service 2>/dev/null || true

# Disable services
log_info "Disabling services..."
systemctl disable tubeca-backend.service 2>/dev/null || true
systemctl disable tubeca-frontend.service 2>/dev/null || true

# Remove service files
log_info "Removing service files..."
rm -f /etc/systemd/system/tubeca-backend.service
rm -f /etc/systemd/system/tubeca-frontend.service

# Reload systemd
systemctl daemon-reload

# Ask about removing application files
echo ""
read -p "Remove application files from $INSTALL_DIR? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_info "Removing application files..."
    rm -rf "$INSTALL_DIR"
    log_info "Application files removed."
else
    log_info "Application files preserved at $INSTALL_DIR"
fi

# Ask about removing service user
echo ""
read -p "Remove service user '$SERVICE_USER'? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    if id "$SERVICE_USER" &>/dev/null; then
        log_info "Removing service user..."
        userdel "$SERVICE_USER" 2>/dev/null || true
        log_info "Service user removed."
    else
        log_info "Service user does not exist."
    fi
else
    log_info "Service user preserved."
fi

log_info ""
log_info "Uninstallation complete!"
