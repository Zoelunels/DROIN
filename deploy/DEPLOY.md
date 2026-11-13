# Deploying the DROIN backend

Target: one Debian 12/13 server (tested plan: 2 GB RAM, 40 GB disk). Everything runs on it directly:
PostgreSQL, the Bun backend (a systemd service) with its PaddleOCR receipt reader, and later Caddy
for HTTPS. `install.sh` does the first install and every update after it.

## 0. Open the ports in the cloud console (once)

Cloud servers have a firewall in the provider's console as well (Tencent Cloud: **Security Group**
for CVM, **Firewall** for Lighthouse). Allow inbound TCP **22, 80, 443** and, for testing by IP,
**3000**. The server's own firewall (ufw) is set up by the script.

## 1. Pack and upload (on your Windows computer)

In CMD, from `E:\Learning\buku-kas`:

```bat
tar --exclude=node_modules --exclude=.venv --exclude=.pip-cache --exclude=uploads --exclude=uploads-test --exclude=.tessdata --exclude=.env --exclude=*.log --exclude=*.local.md -czf droin.tgz backend deploy
```

```bat
scp -i "C:\Users\ACER\Downloads\secret.pem" droin.tgz root@43.156.49.172:/root/
```

Your `.env`, receipt uploads and test logins are not packed: the server keeps its own.

## 2. Install (on the server)

```bash
ssh -i "C:\Users\ACER\Downloads\secret.pem" root@43.156.49.172
```

```bash
rm -rf /root/droin-upload && mkdir -p /root/droin-upload && tar -xzf /root/droin.tgz -C /root/droin-upload && bash /root/droin-upload/deploy/install.sh
```

The first run takes a few minutes (PaddleOCR is ~300 MB). It ends with `DROIN is running.`

## 3. Check it

In a browser: `http://43.156.49.172:3000/health` → `{"status":"ok",…}`, and `http://43.156.49.172:3000/docs`.

Useful on the server:

| What | Command |
|---|---|
| Is it running? | `systemctl status droin` |
| Live logs | `journalctl -u droin -f` |
| Restart | `systemctl restart droin` |
| Server settings | `nano /home/droin/droin/backend/.env` then restart |
| Memory | `free -h` |

## 4. Updating

Repeat steps 1 and 2. The script copies the new code, installs dependencies, runs new migrations
and restarts the service. The database, `.env`, receipts and the OCR install are kept.

## 5. HTTPS with a domain (needed for the Android/iOS build)

Release builds of the app refuse plain `http://`, so the app needs `https://`.

1. Point a DNS **A record**, e.g. `api.yourname.my.id`, to `43.156.49.172`. Wait until
   `ping api.yourname.my.id` shows that IP.
2. On the server. Caddy may already be serving other sites there (this server runs a CV site
   through it), so **add** DROIN's block to the existing Caddyfile, never replace the file.
   Install Caddy only if `caddy version` says it isn't there:
   ```bash
   apt-get install -y caddy
   ```
   Back up the current config, then append DROIN's block to it:
   ```bash
   cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak && cat /home/droin/droin/deploy/Caddyfile >> /etc/caddy/Caddyfile && nano /etc/caddy/Caddyfile
   ```
   At the bottom, replace `api.example.my.id` with your domain and save. Then check it and apply it
   (if `validate` reports an error, nothing changes; restore with `cp /etc/caddy/Caddyfile.bak /etc/caddy/Caddyfile`):
   ```bash
   caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy && ufw delete allow 3000/tcp
   ```
3. Check `https://api.yourname.my.id/health`, and remove port 3000 from the cloud console too.
4. In the app, set `expo.extra.apiUrl` in `frontend/mobile/app.json` to `https://api.yourname.my.id`.

## 6. Backups

Every night at 02:30 the database and receipts are saved to `/var/backups/droin` (14 days kept).
Run one any time with `droin-backup`. Those copies live on the same server, so download one now
and then (on your computer, in CMD):

```bat
scp -i "C:\Users\ACER\Downloads\secret.pem" -r root@43.156.49.172:/var/backups/droin E:\droin-backups
```

Restore a database dump on the server:

```bash
runuser -u postgres -- pg_restore --clean --if-exists -d droin /var/backups/droin/db-YYYY-MM-DD.dump
```

## Memory

2 GB is enough with the 2 GB swap the script adds, but tight. If the server runs out of memory
(the service keeps restarting, `journalctl -u droin` shows it being killed), set
`OCR_SERVICE_URL=off` in `.env` and restart: receipt scans then use Tesseract, which is lighter but
much less accurate.
