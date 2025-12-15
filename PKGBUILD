# Maintainer: wilkie
pkgname=tubeca
pkgver=1.0.0
pkgrel=1
pkgdesc="A self-hosted media streaming platform for managing and streaming personal media libraries"
arch=('x86_64' 'aarch64')
url="https://github.com/wilkie/tubeca"
license=('MIT')
depends=(
    'nodejs>=18'
    'npm'
    'redis'
    'ffmpeg'
)
makedepends=(
    'pnpm'
    'git'
)
optdepends=(
    'nginx: reverse proxy for production deployments'
)
backup=(
    'etc/tubeca/tubeca.env'
    'etc/tubeca/tubeca.config.json'
)
install=tubeca.install
source=(
    "tubeca::git+file://${startdir}"
)
sha256sums=('SKIP')
options=('!strip')  # Skip stripping - node_modules has thousands of JS files

# For release builds, use:
# source=("${pkgname}-${pkgver}.tar.gz::https://github.com/wilkie/tubeca/archive/v${pkgver}.tar.gz")

pkgver() {
    cd "${srcdir}/${pkgname}"
    # Use git describe if tags exist, otherwise use commit count
    local ver
    ver=$(git describe --tags --long 2>/dev/null | sed 's/^v//;s/-/.r/;s/-/./')
    if [ -n "$ver" ]; then
        echo "$ver"
    else
        # Fallback: base version + revision count + short hash
        printf "1.0.0.r%s.%s" "$(git rev-list --count HEAD)" "$(git rev-parse --short HEAD)"
    fi
}

build() {
    cd "${srcdir}/${pkgname}"

    # Create .env file for Prisma (required by prisma.config.ts)
    cat > backend/.env << 'ENVEOF'
DATABASE_URL="file:./prisma/build.db"
ENVEOF

    # Install dependencies
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install

    # Install serve for frontend static file serving
    cd frontend/ui
    pnpm add serve
    cd ../..

    # Build all packages
    pnpm build
}

package() {
    cd "${srcdir}/${pkgname}"

    # Create directories
    install -dm755 "${pkgdir}/opt/tubeca"
    install -dm755 "${pkgdir}/var/lib/tubeca"
    install -dm755 "${pkgdir}/etc/tubeca"
    install -dm755 "${pkgdir}/usr/lib/systemd/system"

    # Copy application files
    cp -r backend "${pkgdir}/opt/tubeca/"
    cp -r frontend "${pkgdir}/opt/tubeca/"
    cp -r packages "${pkgdir}/opt/tubeca/"
    cp -r node_modules "${pkgdir}/opt/tubeca/"

    # Copy scrapers if present
    if [ -d "scrapers" ]; then
        cp -r scrapers "${pkgdir}/opt/tubeca/"
    fi

    # Copy package files
    install -Dm644 package.json "${pkgdir}/opt/tubeca/package.json"
    install -Dm644 pnpm-workspace.yaml "${pkgdir}/opt/tubeca/pnpm-workspace.yaml"

    if [ -f "pnpm-lock.yaml" ]; then
        install -Dm644 pnpm-lock.yaml "${pkgdir}/opt/tubeca/pnpm-lock.yaml"
    fi

    if [ -f "turbo.json" ]; then
        install -Dm644 turbo.json "${pkgdir}/opt/tubeca/turbo.json"
    fi

    # Install configuration files
    install -Dm640 backend/.env.example "${pkgdir}/etc/tubeca/tubeca.env"

    if [ -f "tubeca.config.json" ]; then
        install -Dm640 tubeca.config.json "${pkgdir}/etc/tubeca/tubeca.config.json"
    else
        # Create default config
        echo '{"scrapers":{}}' > "${pkgdir}/etc/tubeca/tubeca.config.json"
        chmod 640 "${pkgdir}/etc/tubeca/tubeca.config.json"
    fi

    # Create symlinks for config files
    ln -sf /etc/tubeca/tubeca.env "${pkgdir}/opt/tubeca/backend/.env"
    ln -sf /etc/tubeca/tubeca.config.json "${pkgdir}/opt/tubeca/tubeca.config.json"

    # Install systemd service files (modified for Arch)
    install -Dm644 /dev/stdin "${pkgdir}/usr/lib/systemd/system/tubeca-backend.service" << 'EOF'
[Unit]
Description=Tubeca Backend API Server
Documentation=https://github.com/wilkie/tubeca
After=network.target redis.service
Wants=redis.service

[Service]
Type=simple
User=tubeca
Group=tubeca
WorkingDirectory=/opt/tubeca/backend
EnvironmentFile=/etc/tubeca/tubeca.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/tubeca/backend/prisma
ReadWritePaths=/var/lib/tubeca

# Environment
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    install -Dm644 /dev/stdin "${pkgdir}/usr/lib/systemd/system/tubeca-frontend.service" << 'EOF'
[Unit]
Description=Tubeca Frontend Web Server
Documentation=https://github.com/wilkie/tubeca
After=network.target tubeca-backend.service
Wants=tubeca-backend.service

[Service]
Type=simple
User=tubeca
Group=tubeca
WorkingDirectory=/opt/tubeca/frontend/ui
ExecStart=/opt/tubeca/frontend/ui/node_modules/.bin/serve -s dist -l 8080
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

# Environment
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    # Install sysusers.d configuration
    install -Dm644 /dev/stdin "${pkgdir}/usr/lib/sysusers.d/tubeca.conf" << 'EOF'
u tubeca - "Tubeca Media Server" /var/lib/tubeca
EOF

    # Install tmpfiles.d configuration
    install -Dm644 /dev/stdin "${pkgdir}/usr/lib/tmpfiles.d/tubeca.conf" << 'EOF'
d /var/lib/tubeca 0750 tubeca tubeca -
EOF

    # Install license
    if [ -f "LICENSE" ]; then
        install -Dm644 LICENSE "${pkgdir}/usr/share/licenses/${pkgname}/LICENSE"
    fi

    # Install documentation
    install -Dm644 README.md "${pkgdir}/usr/share/doc/${pkgname}/README.md" 2>/dev/null || true
    install -Dm644 systemd/README.md "${pkgdir}/usr/share/doc/${pkgname}/systemd.md" 2>/dev/null || true
    install -Dm644 systemd/nginx.conf.example "${pkgdir}/usr/share/doc/${pkgname}/nginx.conf.example" 2>/dev/null || true
}
