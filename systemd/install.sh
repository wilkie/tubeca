#!/bin/bash
set -e

# Tubeca systemd service installation script
# Run as root or with sudo

INSTALL_DIR="/opt/tubeca"
DATA_DIR="/opt/tubeca/data"
SERVICE_USER="tubeca"
SERVICE_GROUP="tubeca"

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

# Check prerequisites
log_info "Checking prerequisites..."

if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed. Please install Node.js 18 or later."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    log_error "Node.js version 18 or later is required. Found: $(node -v)"
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    log_error "pnpm is not installed. Install with: npm install -g pnpm"
    exit 1
fi

if ! command -v redis-cli &> /dev/null; then
    log_warn "Redis CLI not found. Redis is required for background job processing."
    log_warn "Install with: apt install redis-server (Debian/Ubuntu) or dnf install redis (Fedora)"
fi

# Create service user if it doesn't exist
if ! id "$SERVICE_USER" &>/dev/null; then
    log_info "Creating service user: $SERVICE_USER"
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# Create directories
log_info "Creating directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$DATA_DIR"

# Copy application files
log_info "Copying application files to $INSTALL_DIR..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"

# Copy necessary directories
cp -r "$SOURCE_DIR/backend" "$INSTALL_DIR/"
cp -r "$SOURCE_DIR/frontend" "$INSTALL_DIR/"
cp -r "$SOURCE_DIR/packages" "$INSTALL_DIR/"
cp -r "$SOURCE_DIR/scrapers" "$INSTALL_DIR/" 2>/dev/null || true
cp "$SOURCE_DIR/package.json" "$INSTALL_DIR/"
cp "$SOURCE_DIR/pnpm-workspace.yaml" "$INSTALL_DIR/"
cp "$SOURCE_DIR/pnpm-lock.yaml" "$INSTALL_DIR/" 2>/dev/null || true
cp "$SOURCE_DIR/turbo.json" "$INSTALL_DIR/" 2>/dev/null || true
cp "$SOURCE_DIR/tubeca.config.json" "$INSTALL_DIR/" 2>/dev/null || true

# Install dependencies
log_info "Installing dependencies..."
cd "$INSTALL_DIR"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Build the application
log_info "Building application..."
pnpm build

# Create production environment file if it doesn't exist
if [ ! -f "$INSTALL_DIR/backend/.env" ]; then
    log_info "Creating production environment file..."
    cat > "$INSTALL_DIR/backend/.env" << EOF
# Server
PORT=3000
NODE_ENV=production

# Database (SQLite - path relative to backend/)
DATABASE_URL="file:./prisma/prod.db"

# Redis (required for job queue)
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_PASSWORD=your-redis-password

# JWT Authentication - CHANGE THIS!
JWT_SECRET=$(openssl rand -hex 32)

# File Watcher (optional - auto-import new files)
FILE_WATCHER_ENABLED=false

# Data directory for media storage references
DATA_DIR=$DATA_DIR
EOF
    log_warn "Generated new JWT_SECRET. Edit $INSTALL_DIR/backend/.env to configure."
fi

# Run database migrations
log_info "Running database migrations..."
cd "$INSTALL_DIR/backend"
npx prisma migrate deploy 2>/dev/null || npx prisma db push

# Set ownership
log_info "Setting file permissions..."
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$DATA_DIR"
chmod 600 "$INSTALL_DIR/backend/.env"

# Install systemd service files
log_info "Installing systemd service files..."
cp "$SCRIPT_DIR/tubeca-backend.service" /etc/systemd/system/
cp "$SCRIPT_DIR/tubeca-frontend.service" /etc/systemd/system/

# Reload systemd
systemctl daemon-reload

# Enable services
log_info "Enabling services..."
systemctl enable tubeca-backend.service
systemctl enable tubeca-frontend.service

log_info ""
log_info "Installation complete!"
log_info ""
log_info "Next steps:"
log_info "  1. Configure Redis if not already running:"
log_info "     sudo systemctl enable --now redis"
log_info ""
log_info "  2. Edit the backend configuration:"
log_info "     sudo nano $INSTALL_DIR/backend/.env"
log_info ""
log_info "  3. Start the services:"
log_info "     sudo systemctl start tubeca-backend"
log_info "     sudo systemctl start tubeca-frontend"
log_info ""
log_info "  4. Check service status:"
log_info "     sudo systemctl status tubeca-backend"
log_info "     sudo systemctl status tubeca-frontend"
log_info ""
log_info "  5. View logs:"
log_info "     sudo journalctl -u tubeca-backend -f"
log_info "     sudo journalctl -u tubeca-frontend -f"
log_info ""
log_info "Access the application:"
log_info "  Backend API: http://localhost:3000"
log_info "  Frontend:    http://localhost:8080"
log_info ""
log_warn "For production, consider using nginx as a reverse proxy."
