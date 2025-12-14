# Tubeca Installation Guide

This guide covers installing Tubeca as a production service on Linux systems.

## Prerequisites

- Node.js 18 or later
- pnpm package manager
- Redis server
- FFmpeg (for video transcoding)

## Arch Linux / Pacman

The easiest way to install Tubeca on Arch Linux is using the included PKGBUILD.

### Build and Install

```bash
# Clone the repository
git clone https://github.com/wilkie/tubeca.git
cd tubeca

# Build the package
./build-package.sh

# Install the package
sudo pacman -U tubeca-*.pkg.tar.zst
```

### Start Services

```bash
# Enable and start Redis (required for background jobs)
sudo systemctl enable --now redis

# Enable and start Tubeca
sudo systemctl enable --now tubeca-backend tubeca-frontend
```

### Configuration

Configuration files are located in `/etc/tubeca/`:

| File | Description |
|------|-------------|
| `/etc/tubeca/tubeca.env` | Environment variables (JWT secret, database, Redis) |
| `/etc/tubeca/tubeca.config.json` | Application config (scraper API keys) |

Edit the environment configuration:

```bash
sudo nano /etc/tubeca/tubeca.env
```

Key settings:
- `JWT_SECRET` - Auto-generated on install, change if needed
- `REDIS_HOST` / `REDIS_PORT` - Redis connection (default: localhost:6379)
- `FILE_WATCHER_ENABLED` - Set to `true` to auto-import new media files

### Access the Application

- **Frontend**: http://localhost:8080
- **Backend API**: http://localhost:3000
- **API Documentation**: http://localhost:3000/api-docs

### Service Management

```bash
# Check status
sudo systemctl status tubeca-backend
sudo systemctl status tubeca-frontend

# View logs
sudo journalctl -u tubeca-backend -f
sudo journalctl -u tubeca-frontend -f

# Restart after configuration changes
sudo systemctl restart tubeca-backend tubeca-frontend
```

### Updating

```bash
# Pull latest changes
cd tubeca
git pull

# Rebuild and reinstall
./build-package.sh
sudo pacman -U tubeca-*.pkg.tar.zst
```

The package automatically runs database migrations on upgrade.

### Uninstalling

```bash
sudo pacman -R tubeca
```

Configuration and data are preserved. To remove completely:

```bash
sudo rm -rf /etc/tubeca /var/lib/tubeca /opt/tubeca
sudo userdel tubeca
```

### File Locations

| Path | Description |
|------|-------------|
| `/opt/tubeca` | Application files |
| `/etc/tubeca/tubeca.env` | Environment configuration |
| `/etc/tubeca/tubeca.config.json` | Application configuration |
| `/opt/tubeca/backend/prisma/tubeca.db` | SQLite database |
| `/var/lib/tubeca` | Data directory |
| `/usr/lib/systemd/system/tubeca-*.service` | systemd service files |
| `/usr/share/doc/tubeca/` | Documentation |

---

## Other Linux Distributions

For Debian, Ubuntu, Fedora, and other distributions, use the manual installation method.

### Quick Install

```bash
cd /path/to/tubeca
sudo ./systemd/install.sh
```

### Manual Install

See [systemd/README.md](systemd/README.md) for detailed manual installation instructions.

---

## Production Deployment with nginx

For production deployments, it's recommended to use nginx as a reverse proxy to:
- Serve on standard HTTP (80) / HTTPS (443) ports
- Handle SSL/TLS termination
- Efficiently serve static frontend files
- Provide caching and compression

An example nginx configuration is provided at:
- Arch: `/usr/share/doc/tubeca/nginx.conf.example`
- Other: `systemd/nginx.conf.example`

When using nginx, disable the frontend service:

```bash
sudo systemctl disable --now tubeca-frontend
```

---

## Troubleshooting

### Redis Connection Errors

Ensure Redis is running:

```bash
sudo systemctl status redis
redis-cli ping  # Should return PONG
```

### Permission Denied

Ensure files are owned by the tubeca user:

```bash
sudo chown -R tubeca:tubeca /opt/tubeca
```

### Database Errors

Reset the database (warning: deletes all data):

```bash
cd /opt/tubeca/backend
sudo -u tubeca npx prisma migrate reset --force
```

### View Detailed Logs

```bash
sudo journalctl -u tubeca-backend -n 100 --no-pager
```
