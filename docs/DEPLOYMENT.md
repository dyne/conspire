# Deployment Guide

Deploy Conspire as a native binary with a custom landing page. This guide covers manual installation and provides a reference implementation for automation.

## Architecture

Conspire requires direct WebSocket connections — it cannot run behind a reverse proxy like nginx or Apache. The recommended setup uses two ports:

```
your-domain.com:443  → Static landing page (Caddy/nginx)
your-domain.com:8443 → Conspire (direct TLS)
```

The landing page generates random room URLs and redirects users to Conspire.

## Prerequisites

- Linux server (Debian/Ubuntu recommended)
- Domain with DNS A record pointing to your server
- Ports 80 (temp), 443, and 8443 accessible

## Installation

### 1. Download Conspire

```bash
# Create directories
sudo mkdir -p /opt/conspire/cert
cd /opt/conspire

# Download latest release
curl -sL https://api.github.com/repos/dyne/conspire/releases/latest | \
  grep browser_download_url | grep conspire-x86_64 | cut -d'"' -f4 | \
  xargs curl -LO

chmod +x conspire-x86_64
mv conspire-x86_64 conspire

# Download frontend assets
VERSION=$(curl -sL https://api.github.com/repos/dyne/conspire/releases/latest | grep tag_name | cut -d'"' -f4)
curl -sL "https://github.com/dyne/conspire/archive/${VERSION}.tar.gz" | tar xz
mv conspire-${VERSION#v}/front .
rm -rf conspire-${VERSION#v}
```

### 2. TLS Certificates

```bash
# Install certbot
sudo apt install certbot

# Get certificate (stop any service on port 80 first)
sudo certbot certonly --standalone -d your-domain.com

# Copy certs for Conspire
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem /opt/conspire/cert/
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem /opt/conspire/cert/
```

### 3. Systemd Service

Create `/etc/systemd/system/conspire.service`:

```ini
[Unit]
Description=Conspire - Ephemeral Anonymous Chat
After=network.target

[Service]
Type=simple
User=conspire
Group=conspire
WorkingDirectory=/opt/conspire
ExecStart=/opt/conspire/conspire
Environment=EXTERNAL_ADDRESS=your-domain.com
Environment=EXTERNAL_PORT=8443
Environment=TLS_FILE_PRIVATE_KEY=cert/privkey.pem
Environment=TLS_FILE_CERT_CHAIN=cert/fullchain.pem
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Enable the service:

```bash
# Create service user
sudo useradd -r -s /usr/sbin/nologin conspire
sudo chown -R conspire:conspire /opt/conspire/cert

# Start service
sudo systemctl daemon-reload
sudo systemctl enable --now conspire
```

### 4. Firewall

```bash
sudo ufw allow 8443/tcp
```

### 5. Test

Open `https://your-domain.com:8443` — you should see the Conspire interface.

## Landing Page Integration

A landing page provides a friendlier entry point with branding, instructions, and room generation.

### Example Files

A working example is provided in [`docs/landing-example/`](landing-example/):

- [`index.html`](landing-example/index.html) — Minimal landing page with styling
- [`room.js`](landing-example/room.js) — Room ID generator and redirect logic

Copy these to your web root and customize as needed. The key integration point:

```html
<button id="new-room">Start a New Room</button>
<script src="room.js"></script>
```

The script generates a cryptographically random Base58 room ID and redirects to `https://your-domain.com:8443/room/{id}`. Adjust `CONSPIRE_PORT` in `room.js` if using a different port.

### Web Server (Caddy)

```bash
sudo apt install caddy
```

Create `/etc/caddy/Caddyfile`:
```
your-domain.com {
    root * /var/www/your-domain.com
    file_server
    encode gzip
}
```

```bash
sudo systemctl reload caddy
```

## Certificate Renewal

Create `/etc/letsencrypt/renewal-hooks/deploy/conspire.sh`:

```bash
#!/bin/bash
DOMAIN="your-domain.com"
cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem /opt/conspire/cert/
cp /etc/letsencrypt/live/$DOMAIN/privkey.pem /opt/conspire/cert/
chown conspire:conspire /opt/conspire/cert/*.pem
systemctl restart conspire
```

```bash
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/conspire.sh
```

## Automated Deployment

For infrastructure-as-code deployment, see [conspire-infra](https://github.com/stonecharioteer/conspire-infra) which provides Ansible playbooks for automated deployment including:

- Conspire binary installation and updates
- TLS certificate management with auto-renewal
- Landing page deployment via Caddy
- Firewall configuration (UFW)
- Linode-based testing workflow

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EXTERNAL_ADDRESS` | localhost | Public hostname |
| `EXTERNAL_PORT` | 8443 | WebSocket port |
| `TLS_FILE_PRIVATE_KEY` | — | Path to private key |
| `TLS_FILE_CERT_CHAIN` | — | Path to certificate chain |

## Troubleshooting

**Port 8443 not accessible**: Check firewall rules and any cloud provider firewall settings.

**Certificate errors**: Ensure cert files exist and are readable by the conspire user. Check paths in systemd environment.

**WebSocket connection failed**: Conspire requires direct network access. Do not place it behind nginx, Apache, or any reverse proxy.

**CORS errors**: Verify `EXTERNAL_ADDRESS` matches your domain exactly.
