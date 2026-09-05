# Deployment Guide

Deploy Conspire as a native binary or the supported non-root container with a
custom landing page. This guide covers manual installation and a reference
runtime contract.

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

### Container contract

The container has no baked certificate or private key. Mount an operator-owned
directory at `/run/certs:ro` containing `privkey.pem` and `fullchain.pem`, run
the filesystem read-only, and give `/run/conspire` a named volume for durable
statistics state, the onion identity key, and the optional PID file:

Build the image from the same verified CMake inputs used in review (not from an
untracked `conspire` file):

```sh
CONSPIRE_DEPS_PREFIX=/path/to/verified-oatpp-1.4-prefix ./scripts/build-container.sh
```

This prerequisite is intentionally strict: the compatible oatpp 1.4 prefix is
currently unavailable in this checkout and public oatpp 1.3.x must not be used
as a substitute.

```sh
docker run --read-only -v conspire-state:/run/conspire \
  -v /opt/conspire/cert:/run/certs:ro -p 8443:8443 \
  -e EXTERNAL_ADDRESS=your-domain.com -e EXTERNAL_PORT=8443 \
  ghcr.io/dyne/conspire:latest
```

The service runs as a non-root `conspire` user. Do not mount a certificate
directory read-write and do not build demo keys into a derived image.

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
```

The release binary contains the complete version-matched frontend; no separate
web-asset download or runtime `front/` directory is required.

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
After=network.target tor.service

[Service]
Type=simple
User=conspire
Group=conspire
SupplementaryGroups=debian-tor
WorkingDirectory=/opt/conspire
ExecStart=/opt/conspire/conspire --tls
Environment=EXTERNAL_ADDRESS=your-domain.com
Environment=EXTERNAL_PORT=8443
Environment=TLS_FILE_PRIVATE_KEY=cert/privkey.pem
Environment=TLS_FILE_CERT_CHAIN=cert/fullchain.pem
Environment=STATS_STATE_PATH=/var/lib/conspire/stats.json
Environment=TOR_KEY_PATH=/var/lib/conspire/onion.key
StateDirectory=conspire
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
Statistics are checkpointed atomically every minute and during graceful
shutdown. The service restores the retained history and cumulative counters
from `/var/lib/conspire/stats.json` on its next start.

## Tor onion service

Conspire automatically tries a Tor Unix control socket first and
`127.0.0.1:9051` second. A typical Debian/Ubuntu Tor configuration in
`/etc/tor/torrc` is:

```text
ControlSocket /run/tor/control
ControlSocketsGroupWritable 1
CookieAuthentication 1
CookieAuthFileGroupReadable 1
```

Restart Tor after changing `torrc`, add the `conspire` service account to the
Tor control-socket group (commonly `debian-tor`), and keep the
`SupplementaryGroups` setting in the systemd unit. Conspire prefers SAFECOOKIE;
it deliberately refuses deprecated COOKIE-only authentication. A
permission-protected control socket advertising NULL authentication is also
supported.

On first registration Tor returns an ED25519-V3 private key. Conspire writes it
atomically with mode 0600 to `TOR_KEY_PATH`/`--tor-key` and reuses it after
restart, preserving the onion address. An invalid or unreadable existing key is
left untouched and disables Tor integration for that run. On graceful shutdown
Conspire sends `DEL_ONION`; the saved identity remains available for the next
start, but Tor does not advertise a dead backend while Conspire is stopped.

The public onion service defaults to port 80. In the TLS deployment above Tor
forwards it to a second plaintext HTTP listener at `127.0.0.1:8080`; only the
clearnet TLS port needs a firewall rule. Change these with
`TOR_VIRTUAL_PORT`/`--tor-virtual-port` and
`TOR_BACKEND_PORT`/`--tor-backend-port`. Without `--tls`, Tor forwards to the
existing HTTP listener instead.

To use a non-default control endpoint, set `TOR_CONTROL_SOCKET`,
`TOR_CONTROL_HOST`, or `TOR_CONTROL_PORT` (equivalent CLI options are listed by
`conspire --help`). TCP control is restricted to a loopback host. Use
`--no-tor` when onion registration is intentionally disabled.

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
| `EXTERNAL_PORT` | 8080 (8443 with `--tls`) | HTTP/WebSocket port |
| `TLS_FILE_PRIVATE_KEY` | — | Private key path, read only with `--tls` |
| `TLS_FILE_CERT_CHAIN` | — | Certificate-chain path, read only with `--tls` |
| `TOR_CONTROL_SOCKET` | `/run/tor/control` | Preferred Tor Unix control socket |
| `TOR_CONTROL_HOST` | `127.0.0.1` | Loopback Tor control fallback host |
| `TOR_CONTROL_PORT` | `9051` | Loopback Tor control fallback port |
| `TOR_KEY_PATH` | Beside statistics state, otherwise working directory | Persistent ED25519-V3 onion key |
| `TOR_BACKEND_PORT` | `8080` | Loopback-only plaintext backend when TLS is active |
| `TOR_VIRTUAL_PORT` | `80` | Public onion-service port |

For a local certificate-free smoke test, run `./conspire` without TLS options
and open <http://localhost:8080>. Use `./conspire --tls` for the certificate
configuration described above.

## Troubleshooting

**Port 8443 not accessible**: Check firewall rules and any cloud provider firewall settings.

**Certificate errors**: Ensure cert files exist and are readable by the conspire user. Check paths in systemd environment.

For the container, the corresponding paths are
`/run/certs/privkey.pem` and `/run/certs/fullchain.pem`; verify the mount is
read-only and that the files are readable by its non-root UID.

**WebSocket connection failed**: Conspire requires direct network access. Do not place it behind nginx, Apache, or any reverse proxy.

**CORS errors**: Verify `EXTERNAL_ADDRESS` matches your domain exactly.
