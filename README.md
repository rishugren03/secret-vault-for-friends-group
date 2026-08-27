# 🔒 Private Shared Vault

End-to-end encrypted notes for small groups. Client-side encryption using Web Crypto API, with SQLite or PostgreSQL backend for shared persistence.

## Security Model

- **Client-side encryption only** — passphrase never leaves the browser
- Uses PBKDF2 (250,000 iterations, SHA-256) + AES-GCM
- Server only stores encrypted blobs + salt (never sees plaintext)
- Wrong passphrase = decryption fails (AES-GCM auth tag mismatch)
- Auto-locks after 5 minutes of inactivity

## Setup

1. Install dependencies:
```bash
npm install
```

2. Choose your database:

**Option A: SQLite (default)**
```bash
npm start
```
Creates `vault.db` automatically.

**Option B: PostgreSQL**
```bash
# Copy .env.example to .env
cp .env.example .env

# Edit .env and set DATABASE_URL
# Example: DATABASE_URL=postgresql://user:password@localhost:5432/vault_db

npm start
```

3. Open `http://localhost:3000/vault.html` in any browser

## Usage

- First person sets the shared passphrase
- Everyone else uses the same passphrase to unlock
- Add/edit/delete notes — changes sync across all devices
- **Losing the passphrase = losing all data permanently** (no recovery)

## Deploy

### Cloud Platforms (Render, Heroku, Railway)

These platforms auto-provide a `DATABASE_URL` when you add a PostgreSQL database:

1. Create a new Web Service
2. Add a PostgreSQL database (will set `DATABASE_URL` automatically)
3. Deploy — the app will detect PostgreSQL and use it

**Note:** SQLite requires native compilation and won't work on all cloud platforms. Use PostgreSQL for production deployments.

### VPS or Docker

For VPS/Docker deployments, you can use either:
- SQLite (local file): just `npm start`
- PostgreSQL: set `DATABASE_URL` environment variable

## Security Disclaimer

This is a lightweight tool for convenience, **not audited security software**. 

- Don't use it for highly sensitive data (financial credentials, etc.)
- Anyone with the link + passphrase has full access
- Weak passphrases can be brute-forced — use a long, random one
- The encrypted blob is safe from direct reading, but encryption is only as strong as the passphrase

## Tech Stack

- Vanilla JS + Web Crypto API (AES-GCM, PBKDF2)
- Node.js + Express
- better-sqlite3 or pg (PostgreSQL)
- Zero build step, single HTML file
