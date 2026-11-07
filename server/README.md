# Boltwork sync server

A small self-hosted server that keeps your Boltwork vault in step across computers.
It stores only end-to-end encrypted records and attachment files: it never sees your password, your Secret Key, your master key or anything in your vault.
One Node.js process with a SQLite file and no other dependencies. Licensed AGPL-3.0-or-later.

## Run it with Docker

```bash
cd server
docker compose up -d
```

This builds the image (from the repository root, so the whole source checkout is needed) and starts it on `127.0.0.1:8787`,
with data in the `strongroom-data` volume. To build the image by hand, run `docker build -f server/Dockerfile -t boltwork-server .` from the repository root.
On a home network you can connect over plain http, for example `http://192.168.1.20:8787`: the app allows http for
`localhost`, private addresses (10.x, 172.16–31.x, 192.168.x) and `.local` names. To reach it from other computers, change the
port mapping in `docker-compose.yml` from `127.0.0.1:8787:8787` to `8787:8787`. Your vault stays end-to-end encrypted over http,
but anyone on the network could see your sync sign-in, so don't expose an http server to the internet.

For anything reachable from outside your home, put it behind HTTPS. For example, with Caddy:

```
vault.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

In Boltwork, open **Settings → Sync → Set up sync…** and enter `https://vault.example.com`.

## Web vault (optional)

The server can also serve Boltwork's screens to a browser, so you can open your vault from any computer at the server's address.
It's off by default. Turn it on with `WEB_VAULT: "on"` in `docker-compose.yml`, then `docker compose up -d`.

- Sign in with your email, account password and Secret Key. Accounts are created in a Boltwork app (turn on sync to this server);
  the web vault only signs in.
- The vault downloads still encrypted and is unlocked in the browser tab, with the same encryption as the apps. Changes are
  encrypted in the tab before they're sent. Nothing stays in the browser after you lock or close the tab, apart from your email
  (and your Secret Key, only if you tick **Remember my Secret Key in this browser**). Locking also ends the tab's server session.
- What's left out, because it needs the computer itself: the SSH agent, the browser extension, Quick Access and Auto-Type,
  quick unlock, scanning QR codes from the screen, and creating SSH keys or passkeys. Items of every kind still show and sync.
- Use it over https (or on `localhost`). Browsers only allow copying to the clipboard on secure pages.

**The trade-off.** With the apps, the code that handles your password comes from the app you installed. With the web vault, it
comes from the server each time you open the page. Someone who takes over the server, or the https proxy in front of it, could
change that code to capture your password and Secret Key the next time you sign in. The page is served with a strict Content
Security Policy (scripts only from this server, no framing), which stops other sites from injecting code, but it can't protect
you from the server itself. Leave the web vault off if you'd rather not trust the server that far; sync keeps working either way.

## Run it without Docker

Needs Node.js 22.13 or newer (for the built-in SQLite).

```bash
cd server
npm install
npm run build
DATA_DIR=./data PORT=8787 node dist/server.js
```

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port to listen on |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where the SQLite database, attachment files (`blobs/`) and server secret live. Back this up. |
| `SIGNUPS` | `first` | `first`: only the first account may sign up (good for one person). `open`: anyone who can reach it. `closed`: nobody. |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy, so rate limits use the client address it forwards |
| `STORAGE_LIMIT_MB` | `0` (no limit) | Attachment storage allowed per account |
| `WEB_VAULT` | `off` | `on` serves the web vault at `/` (see above) |
| `WEB_DIR` | `web` next to `server.js` | The web vault's files. Without Docker, build them with `npm run build` and point this at `dist-web`. |

Attachments upload as single requests of up to about 140 MB (a 100 MB file once sealed). If you use a reverse proxy, raise its body size limit, for example `client_max_body_size 150m;` in nginx.

## Backups

Back up `DATA_DIR` (the volume). The database holds only encrypted data, but you still need your password and Secret Key to restore it into Boltwork,
and every computer also keeps a full local copy of the vault.

## API

All under `/api/v1`, JSON in and out.

| Route | Auth | What it does |
|---|---|---|
| `GET /health` | – | Server name and whether sign-ups are open |
| `POST /accounts` | – | Create an account: email, auth key, KDF parameters, wrapped master key, account id |
| `POST /prelogin` | – | KDF parameters for an email (stable fake values for unknown emails) |
| `POST /login` | – | Email + auth key → session token, KDF parameters, wrapped master key |
| `POST /logout` | token | End this session |
| `GET /account` | token | Email and signed-in devices |
| `PUT /account/keys` | token | After a password change: new auth key and wrapped key; signs out other devices |
| `DELETE /account` | token | Delete the account and all its records |
| `GET /records?since=N` | token | Records changed after revision N (paged, 1000 at a time) |
| `POST /records` | token | Upload records; each says which revision it was based on, and stale ones come back as conflicts |
| `GET /blobs` | token | List the account's attachment files (id, size, upload time) |
| `PUT /blobs/<id>` | token | Upload a sealed attachment file (raw body) |
| `GET /blobs/<id>` | token | Download a sealed attachment file |
| `DELETE /blobs/<id>` | token | Delete an attachment file |

See [SECURITY.md](../SECURITY.md) for how the encryption and sign-in work.
