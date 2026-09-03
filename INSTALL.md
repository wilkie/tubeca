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
sudo systemctl enable --now tubeca-backend tubeca-worker
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

- **Web UI and API**: http://localhost:3000 (the API process serves the built frontend)
- **API Documentation**: http://localhost:3000/api-docs

Two services run: `tubeca-backend` (HTTP API + web UI) and `tubeca-worker` (library scans,
metadata scraping, file watching). Both run the same `dist/index.js` with a different
`TUBECA_ROLE`; a single process can do everything with `TUBECA_ROLE=all`.

### Service Management

```bash
# Check status
sudo systemctl status tubeca-backend
sudo systemctl status tubeca-worker

# View logs
sudo journalctl -u tubeca-backend -f
sudo journalctl -u tubeca-worker -f

# Restart after configuration changes
sudo systemctl restart tubeca-backend tubeca-worker
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

The API process already serves the web UI, so nginx is optional. Use it to:
- Serve on standard HTTP (80) / HTTPS (443) ports
- Handle SSL/TLS termination
- Add compression and edge caching

An example nginx configuration is provided at:
- Arch: `/usr/share/doc/tubeca/nginx.conf.example`
- Other: `systemd/nginx.conf.example`

The example proxies everything to port 3000; the backend keeps serving the static files.

---

## Docker

A multi-stage `Dockerfile` and a `docker-compose.yml` (API, worker and Redis) are in the
repository root:

```bash
mkdir -p data media            # SQLite DB + optional tubeca.config.json; your media
JWT_SECRET=$(openssl rand -hex 32) docker compose up -d
```

The UI and API are on http://localhost:3000. Media is bind-mounted read-only at `/media`
inside the containers, so library paths start with `/media/...`. Migrations run on start.

The compose file pulls the published image `ghcr.io/wilkie/tubeca` (`latest` = newest release
tag, `edge` = current `main`, plus `1.2.3` / `1.2` version tags). Set `TUBECA_IMAGE=tubeca:local`
and add `--build` to run from a checkout instead.

## Releases

Versions are git tags of the form `v1.2.3`. Tagging does three things: `pkgver()` in the
PKGBUILD produces `1.2.3` instead of a commit-count fallback, CI publishes the container image
under that version and `latest`, and `CHANGELOG.md` gets a dated section.

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
