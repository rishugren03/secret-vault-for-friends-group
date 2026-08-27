import express from 'express';
import Database from 'better-sqlite3';
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

    // Initialize PostgreSQL table
    await pgPool.query(`
        CREATE TABLE IF NOT EXISTS vault (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            salt TEXT NOT NULL DEFAULT '',
            encrypted_data TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', database: usePostgres ? 'postgresql' : 'sqlite' });
});

app.listen(PORT, () => {
    console.log(`🔒 Private Shared Vault running on http://localhost:${PORT}`);
    console.log(`📂 Database: ${usePostgres ? 'PostgreSQL' : 'SQLite'}`);
});
