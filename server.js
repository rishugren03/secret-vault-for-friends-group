import express from 'express';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Use PostgreSQL if DATABASE_URL is set, otherwise SQLite
const usePostgres = !!process.env.DATABASE_URL;
let db;
let pgPool;

if (usePostgres) {
    console.log('Using PostgreSQL database');
    pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    });

    // Initialize PostgreSQL tables
    await pgPool.query(`
        CREATE TABLE IF NOT EXISTS vault (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            salt TEXT NOT NULL DEFAULT '',
            encrypted_data TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pgPool.query(`
        CREATE TABLE IF NOT EXISTS vault_users (
            id SERIAL PRIMARY KEY,
            vault_id INTEGER NOT NULL REFERENCES vault(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
            joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(vault_id, name)
        )
    `);

    // Insert default row if empty
    const result = await pgPool.query('SELECT COUNT(*) as count FROM vault');
    if (parseInt(result.rows[0].count) === 0) {
        await pgPool.query(`
            INSERT INTO vault (id, salt, encrypted_data, updated_at)
            VALUES (1, '', '', CURRENT_TIMESTAMP)
        `);
    }
} else {
    // Try to load SQLite, but fail gracefully if not available
    let Database;
    try {
        const sqlite3Module = await import('better-sqlite3');
        Database = sqlite3Module.default;
    } catch (err) {
        console.error('\n⚠️  SQLite not available. Please set DATABASE_URL to use PostgreSQL.\n');
        console.error('Example: DATABASE_URL=postgresql://user:pass@host:5432/dbname\n');
        process.exit(1);
    }

    db = new Database('vault.db');
    console.log('Using SQLite database: vault.db');

    // Initialize SQLite database
    db.exec(`
        CREATE TABLE IF NOT EXISTS vault (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            salt TEXT NOT NULL DEFAULT '',
            encrypted_data TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS vault_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vault_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
            joined_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(vault_id, name)
        )
    `);

    // Insert default row if empty
    const count = db.prepare('SELECT COUNT(*) as count FROM vault').get();
    if (count.count === 0) {
        db.prepare(`
            INSERT INTO vault (id, salt, encrypted_data, updated_at)
            VALUES (1, '', '', datetime('now'))
        `).run();
    }
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// Redirect root to vault
app.get('/', (req, res) => {
    res.redirect('/vault.html');
});

// Get vault data (salt + encrypted blob)
app.get('/api/vault', async (req, res) => {
    try {
        if (usePostgres) {
            const result = await pgPool.query('SELECT salt, encrypted_data, updated_at FROM vault WHERE id = 1');
            const row = result.rows[0];
            res.json({
                salt: row.salt,
                encryptedData: row.encrypted_data,
                updatedAt: row.updated_at
            });
        } else {
            const row = db.prepare('SELECT salt, encrypted_data, updated_at FROM vault WHERE id = 1').get();
            res.json({
                salt: row.salt,
                encryptedData: row.encrypted_data,
                updatedAt: row.updated_at
            });
        }
    } catch (error) {
        console.error('Error fetching vault:', error);
        res.status(500).json({ error: 'Failed to fetch vault' });
    }
});

// Update vault data
app.post('/api/vault', async (req, res) => {
    const { salt, encryptedData } = req.body;

    if (!salt || !encryptedData) {
        return res.status(400).json({ error: 'salt and encryptedData are required' });
    }

    try {
        if (usePostgres) {
            await pgPool.query(`
                UPDATE vault
                SET salt = $1, encrypted_data = $2, updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
            `, [salt, encryptedData]);

            const result = await pgPool.query('SELECT updated_at FROM vault WHERE id = 1');
            res.json({ success: true, updatedAt: result.rows[0].updated_at });
        } else {
            db.prepare(`
                UPDATE vault
                SET salt = ?, encrypted_data = ?, updated_at = datetime('now')
                WHERE id = 1
            `).run(salt, encryptedData);

            const row = db.prepare('SELECT updated_at FROM vault WHERE id = 1').get();
            res.json({ success: true, updatedAt: row.updated_at });
        }
    } catch (error) {
        console.error('Error saving vault:', error);
        res.status(500).json({ error: 'Failed to save vault' });
    }
});

// Get all users in vault
app.get('/api/vault/users/:salt', async (req, res) => {
    try {
        if (usePostgres) {
            const result = await pgPool.query(`
                SELECT name, role, joined_at
                FROM vault_users vu
                JOIN vault v ON vu.vault_id = v.id
                WHERE v.salt = $1
            `, [req.params.salt]);
            res.json(result.rows);
        } else {
            const result = db.prepare(`
                SELECT vu.name, vu.role, vu.joined_at
                FROM vault_users vu
                JOIN vault v ON vu.vault_id = v.id
                WHERE v.salt = ?
            `).all(req.params.salt);
            res.json(result);
        }
    } catch (error) {
        console.error('Error fetching vault users:', error);
        res.status(500).json({ error: 'Failed to fetch vault users' });
    }
});

// Add user to vault (owner only)
app.post('/api/vault/users', async (req, res) => {
    const { salt, name, role } = req.body;

    if (!salt || !name || !role) {
        return res.status(400).json({ error: 'salt, name, and role are required' });
    }

    if (!['owner', 'member'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }

    try {
        if (usePostgres) {
            // Get vault_id from salt
            const vaultResult = await pgPool.query(
                'SELECT id FROM vault WHERE salt = $1', [salt]
            );
            if (vaultResult.rows.length === 0) {
                return res.status(404).json({ error: 'Vault not found' });
            }
            const vaultId = vaultResult.rows[0].id;

            // Check if user already exists
            const existingUser = await pgPool.query(
                'SELECT id FROM vault_users WHERE vault_id = $1 AND name = $2',
                [vaultId, name]
            );
            if (existingUser.rows.length > 0) {
                return res.status(400).json({ error: 'User already exists in vault' });
            }

            // Add user to vault
            await pgPool.query(
                'INSERT INTO vault_users (vault_id, name, role) VALUES ($1, $2, $3)',
                [vaultId, name, role]
            );
        } else {
            // Get vault_id from salt
            const vaultResult = db.prepare(
                'SELECT id FROM vault WHERE salt = ?'
            ).get(salt);

            if (!vaultResult) {
                return res.status(404).json({ error: 'Vault not found' });
            }

            // Check if user already exists
            const existingUser = db.prepare(
                'SELECT id FROM vault_users WHERE vault_id = ? AND name = ?'
            ).get(vaultResult.id, name);

            if (existingUser) {
                return res.status(400).json({ error: 'User already exists in vault' });
            }

            // Add user to vault
            db.prepare(
                'INSERT INTO vault_users (vault_id, name, role) VALUES (?, ?, ?)'
            ).run(vaultResult.id, name, role);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error adding vault user:', error);
        res.status(500).json({ error: 'Failed to add vault user' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', database: usePostgres ? 'postgresql' : 'sqlite' });
});

// Reset vault (for testing/debugging - remove in production or protect with auth)
app.post('/api/vault/reset', async (req, res) => {
    try {
        if (usePostgres) {
            await pgPool.query(`
                UPDATE vault
                SET salt = '', encrypted_data = '', updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
            `);
        } else {
            db.prepare(`
                UPDATE vault
                SET salt = '', encrypted_data = '', updated_at = datetime('now')
                WHERE id = 1
            `).run();
        }
        res.json({ success: true, message: 'Vault reset successfully' });
    } catch (error) {
        console.error('Error resetting vault:', error);
        res.status(500).json({ error: 'Failed to reset vault' });
    }
});

app.listen(PORT, () => {
    console.log(`🔒 Private Shared Vault running on http://localhost:${PORT}`);
    console.log(`📂 Database: ${usePostgres ? 'PostgreSQL' : 'SQLite'}`);
});
