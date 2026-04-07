const fs = require('fs');
const path = require('path');

const DB_PATH = path.join('/tmp', 'jude-harper-db.json');

function getDefaultData() {
  return {
    books: [],
    orders: [],
    subscribers: [],
    _nextId: { books: 1, orders: 1, subscribers: 1 }
  };
}

function readDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return getDefaultData();
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getDb() {
  const data = readDb();

  return {
    // Query helpers
    all(table, filter) {
      let rows = data[table] || [];
      if (filter) rows = rows.filter(filter);
      return rows;
    },

    get(table, filter) {
      return (data[table] || []).find(filter) || null;
    },

    insert(table, row) {
      if (!data._nextId[table]) data._nextId[table] = 1;
      row.id = data._nextId[table]++;
      row.created_at = new Date().toISOString();
      if (!data[table]) data[table] = [];
      data[table].push(row);
      writeDb(data);
      return row;
    },

    update(table, id, updates) {
      const idx = (data[table] || []).findIndex(r => r.id === id);
      if (idx === -1) return null;
      Object.assign(data[table][idx], updates);
      writeDb(data);
      return data[table][idx];
    },

    delete(table, id) {
      data[table] = (data[table] || []).filter(r => r.id !== id);
      writeDb(data);
    },

    count(table, filter) {
      let rows = data[table] || [];
      if (filter) rows = rows.filter(filter);
      return rows.length;
    },

    sum(table, field, filter) {
      let rows = data[table] || [];
      if (filter) rows = rows.filter(filter);
      return rows.reduce((acc, r) => acc + (r[field] || 0), 0);
    }
  };
}

function initDb() {
  if (!fs.existsSync(DB_PATH)) {
    writeDb(getDefaultData());
  }
  console.log('Database initialized');
}

module.exports = { getDb, initDb };
