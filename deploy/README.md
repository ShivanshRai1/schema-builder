# Always-on SimulAI on :8088 (DigitalOcean)

Makes [http://HOST:8088/](http://HOST:8088/) serve the UI and proxy `/sim_api.php` + `/workspace_api.php` so any visitor can Run and share one global Save without SSH.

## What these units do

| Unit | Role | Port |
|------|------|------|
| `simulai-php.service` | PHP `sim_api.php` + `workspace_api.php` | `127.0.0.1:18091` only |
| `simulai-static.service` | Static `dist/` + proxy to PHP | `0.0.0.0:8088` |

They restart on crash and start on boot. They do **not** change nginx or other apps.

## One-time setup (SSH as a user with sudo)

```bash
# 1) Ensure files exist
ls /home/reactfe/simulai-php/sim_api.php
ls /home/reactfe/simulai-php/sim_config.php
ls /home/reactfe/simulai-php/workspace_api.php
# writable store for shared Save (created automatically if PHP can mkdir)
mkdir -p /home/reactfe/simulai-php/data
chmod 775 /home/reactfe/simulai-php/data
ls /var/www/simulai-schematic/dist/index.html
ls /home/reactfe/schema-builder-build/repo/scripts/serve-static-with-sim.mjs

# 2) Stop any manual/nohup copies on these ports (this app only)
ss -tlnp | grep -E '8088|18091'
# kill only those PIDs if they are your php/node for simulai

# 3) Install units (paths assume reactfe + repo location above)
sudo cp /home/reactfe/schema-builder-build/repo/deploy/simulai-php.service /etc/systemd/system/
sudo cp /home/reactfe/schema-builder-build/repo/deploy/simulai-static.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now simulai-php.service
sudo systemctl enable --now simulai-static.service

# 4) Verify
systemctl status simulai-php.service --no-pager
systemctl status simulai-static.service --no-pager
curl -s http://127.0.0.1:18091/sim_api.php | head
curl -s 'http://127.0.0.1:18091/workspace_api.php?action=get' | head
curl -s http://127.0.0.1:8088/sim_api.php | head
curl -s 'http://127.0.0.1:8088/workspace_api.php?action=get' | head
```

Sim curls should return JSON. Workspace GET returns `{"ok":false,"error":"empty"}` until the first Save.

## After a reboot

No manual start. Check with:

```bash
systemctl is-active simulai-php simulai-static
ss -tlnp | grep -E '8088|18091'
```

## After you upload a new UI (`dist/`)

No restart required for static files (they are read from disk). If the proxy script itself changed:

```bash
cd /home/reactfe/schema-builder-build/repo && git pull origin main
sudo systemctl restart simulai-static.service
```

Also copy `workspace_api.php` into the PHP docroot when deploying PHP changes:

```bash
cp /home/reactfe/schema-builder-build/repo/php-sim/workspace_api.php /home/reactfe/simulai-php/
sudo systemctl restart simulai-php.service   # only if PHP files changed
```

## Disable later (if needed)

```bash
sudo systemctl disable --now simulai-static.service simulai-php.service
```
