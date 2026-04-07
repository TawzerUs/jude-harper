const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'store.db');

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      long_description TEXT,
      price REAL NOT NULL DEFAULT 0,
      cover_image TEXT,
      file_path TEXT,
      category TEXT DEFAULT 'book',
      featured INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      stripe_session_id TEXT,
      stripe_payment_id TEXT,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      download_token TEXT,
      download_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id)
    );

    CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.close();
  console.log('Database initialized');
}

module.exports = { getDb, initDb };
