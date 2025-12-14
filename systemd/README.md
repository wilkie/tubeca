# Tubeca systemd Services

This directory contains systemd service files for running Tubeca as a production service.

## Prerequisites

- Node.js 18 or later
- pnpm package manager
- Redis (for background job processing)
- Linux with systemd

## Arch Linux (pacman)

For Arch Linux users, the easiest installation method is using the PKGBUILD:

```bash
# From the repository root
./build-package.sh

# Install the package
sudo pacman -U tubeca-*.pkg.tar.zst

# Start services
sudo systemctl enable --now redis
sudo systemctl enable --now tubeca-backend tubeca-frontend
```

The package:
- Creates a `tubeca` system user
- Installs to `/opt/tubeca`
- Configuration in `/etc/tubeca/`
- Automatically runs database migrations
- Generates a secure JWT secret

See also: `PKGBUILD` and `tubeca.install` in the repository root.

## Quick Installation (Other Distros)

```bash
# Clone or copy the repository to your server
cd /path/to/tubeca

# Run the installation script as root
sudo ./systemd/install.sh
```

## Manual Installation

### 1. Create Service User

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin tubeca
```

### 2. Install Application

```bash
# Create installation directory
sudo mkdir -p /opt/tubeca
sudo mkdir -p /opt/tubeca/data

# Copy application files
sudo cp -r . /opt/tubeca/

# Install dependencies
cd /opt/tubeca
sudo pnpm install

# Build the application
sudo pnpm build
```

### 3. Configure Environment

```bash
# Create production environment file
sudo cp /opt/tubeca/backend/.env.example /opt/tubeca/backend/.env
sudo nano /opt/tubeca/backend/.env
```

Important settings:
- `NODE_ENV=production`
- `JWT_SECRET` - Generate a secure random string
- `DATABASE_URL` - SQLite path for production database
- `REDIS_HOST` / `REDIS_PORT` - Redis connection settings

### 4. Run Database Migrations

```bash
cd /opt/tubeca/backend
sudo npx prisma migrate deploy
```

### 5. Set Permissions

```bash
sudo chown -R tubeca:tubeca /opt/tubeca
sudo chmod 600 /opt/tubeca/backend/.env
```

### 6. Install Service Files

```bash
sudo cp /opt/tubeca/systemd/tubeca-backend.service /etc/systemd/system/
sudo cp /opt/tubeca/systemd/tubeca-frontend.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### 7. Enable and Start Services

```bash
# Enable Redis
sudo systemctl enable --now redis

# Enable Tubeca services
sudo systemctl enable tubeca-backend tubeca-frontend

# Start services
sudo systemctl start tubeca-backend tubeca-frontend
```

## Service Management

```bash
# Check status
sudo systemctl status tubeca-backend
sudo systemctl status tubeca-frontend

# View logs
sudo journalctl -u tubeca-backend -f
sudo journalctl -u tubeca-frontend -f

# Restart services
sudo systemctl restart tubeca-backend
sudo systemctl restart tubeca-frontend

# Stop services
sudo systemctl stop tubeca-backend tubeca-frontend
```

## Default Ports

- **Backend API**: `http://localhost:3000`
- **Frontend**: `http://localhost:8080`

## Production with nginx (Recommended)

For production deployments, use nginx as a reverse proxy to:
- Serve the frontend on standard HTTP/HTTPS ports
- Proxy API requests to the backend
- Handle SSL/TLS termination
- Serve static files efficiently

### Example nginx Configuration

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect to HTTPS (recommended)
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Frontend static files
    location / {
        root /opt/tubeca/frontend/ui/dist;
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

When using nginx:
1. Disable the `tubeca-frontend` service: `sudo systemctl disable --now tubeca-frontend`
2. Configure nginx to serve the frontend directly
3. Enable nginx: `sudo systemctl enable --now nginx`

## Updating Tubeca

```bash
# Stop services
sudo systemctl stop tubeca-backend tubeca-frontend

# Update code
cd /opt/tubeca
sudo git pull  # or copy new files

# Install dependencies and rebuild
sudo pnpm install
sudo pnpm build

# Run migrations
cd backend
sudo npx prisma migrate deploy

# Restart services
sudo systemctl start tubeca-backend tubeca-frontend
```

## Troubleshooting

### Services won't start

Check the journal for errors:
```bash
sudo journalctl -u tubeca-backend -n 50 --no-pager
```

Common issues:
- Redis not running
- Missing environment variables
- Database migration not applied
- Permission issues on files

### Redis connection errors

Ensure Redis is running:
```bash
sudo systemctl status redis
redis-cli ping  # Should return PONG
```

### Permission denied errors

Ensure files are owned by the service user:
```bash
sudo chown -R tubeca:tubeca /opt/tubeca
```

### Database errors

Reset and recreate the database:
```bash
cd /opt/tubeca/backend
sudo -u tubeca npx prisma migrate reset --force
```

## File Locations

### Manual Installation / Other Distros

| Path | Description |
|------|-------------|
| `/opt/tubeca` | Application installation directory |
| `/opt/tubeca/backend/.env` | Backend environment configuration |
| `/opt/tubeca/backend/prisma/prod.db` | Production SQLite database |
| `/opt/tubeca/data` | Media data directory |
| `/etc/systemd/system/tubeca-*.service` | systemd service files |

### Arch Linux (pacman package)

| Path | Description |
|------|-------------|
| `/opt/tubeca` | Application installation directory |
| `/etc/tubeca/tubeca.env` | Backend environment configuration |
| `/etc/tubeca/tubeca.config.json` | Application configuration (scrapers, etc.) |
| `/opt/tubeca/backend/prisma/tubeca.db` | Production SQLite database |
| `/var/lib/tubeca` | Data directory |
| `/usr/lib/systemd/system/tubeca-*.service` | systemd service files |
| `/usr/share/doc/tubeca/` | Documentation and examples |
