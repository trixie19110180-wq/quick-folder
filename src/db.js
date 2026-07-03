const fs = require("fs");
const Database = require("better-sqlite3");
const { config } = require("./config");

fs.mkdirSync(config.dataDir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('file', 'text')),
    password_hash TEXT,
    delete_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    text_content TEXT,
    text_preview TEXT,
    text_bytes INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_delete_at ON posts(delete_at);
  CREATE INDEX IF NOT EXISTS idx_files_post_id ON files(post_id);
`);

module.exports = db;

if (require.main === module) {
  console.log(`Database ready at ${config.dbPath}`);
}
