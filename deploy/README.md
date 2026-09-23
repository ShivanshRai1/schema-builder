# Always-on SimulAI on :8088 (DigitalOcean)

Makes [http://HOST:8088/](http://HOST:8088/) serve the UI and proxy `/sim_api.php`, `/workspace_api.php`, and `/api/assistant` so any visitor can Run, save, and use Gemini chat without SSH.

## What these units do

| Unit | Role | Port |
|------|------|------|
| `simulai-php.service` | PHP `sim_api.php` + `workspace_api.php` | `127.0.0.1:18091` only |
| `simulai-assistant.service` | Gemini chat API | `127.0.0.1:8787` only |
| `simulai-static.service` | Static `dist/` + proxy to PHP + assistant | `0.0.0.0:8088` |

They restart on crash and start on boot. They do **not** change nginx or other apps. **Do not** open `8787` in ufw — only `:8088` proxies `/api/assistant`.

## One-time setup (SSH as a user with sudo)

```bash
# 1) Ensure files exist
ls /home/reactfe/simulai-php/sim_api.php
ls /home/reactfe/simulai-php/sim_config.php
ls /home/reactfe/simulai-php/workspace_api.php
mkdir -p /home/reactfe/simulai-php/data
chmod 775 /home/reactfe/simulai-php/data
ls /var/www/simulai-schematic/dist/index.html
ls /home/reactfe/schema-builder-build/repo/scripts/serve-static-with-sim.mjs

# 2) Assistant deps + API key (never commit .env)
cd /home/reactfe/schema-builder-build/repo/server
npm install
# Create server/.env with:
#   GEMINI_API_KEY=your-key-here
# Optional: GEMINI_MODEL=gemini-3.1-flash-lite
test -f .env && grep -q '^GEMINI_API_KEY=.' .env && echo "key ok" || echo "MISSING GEMINI_API_KEY in server/.env"

# 3) Install units
sudo cp /home/reactfe/schema-builder-build/repo/deploy/simulai-php.service /etc/systemd/system/
sudo cp /home/reactfe/schema-builder-build/repo/deploy/simulai-assistant.service /etc/systemd/system/
sudo cp /home/reactfe/schema-builder-build/repo/deploy/simulai-static.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now simulai-php.service
sudo systemctl enable --now simulai-assistant.service
sudo systemctl enable --now simulai-static.service

# 4) Verify
systemctl status simulai-php simulai-assistant simulai-static --no-pager
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8088/api/assistant -X POST \
  -H 'Content-Type: application/json' \
  -d '{"message":"hello","context":{"components":[],"netlist":""}}' | head
# 8787 must NOT be public:
ss -tlnp | grep 8787
```

Sim curls should return JSON. Assistant `/health` should show `gemini:…` when the key is set.

## After a reboot

```bash
systemctl is-active simulai-php simulai-assistant simulai-static
ss -tlnp | grep -E '8088|18091|8787'
```

## After you push UI / proxy changes

```bash
cd /home/reactfe/schema-builder-build/repo
git fetch origin
git checkout backup/pre-wire-fixes-2026-09-21   # or your deploy branch
git pull
cd server && npm install && cd ..
# Rebuild UI and publish dist:
npm install && npm run build
sudo mkdir -p /var/www/simulai-schematic
sudo rsync -a --delete dist/ /var/www/simulai-schematic/dist/
sudo systemctl restart simulai-assistant.service
sudo systemctl restart simulai-static.service
```

Also copy `workspace_api.php` into the PHP docroot when deploying PHP changes:

```bash
cp /home/reactfe/schema-builder-build/repo/php-sim/workspace_api.php /home/reactfe/simulai-php/
sudo systemctl restart simulai-php.service   # only if PHP files changed
```

## Disable later (if needed)

```bash
sudo systemctl disable --now simulai-static.service simulai-assistant.service simulai-php.service
```
