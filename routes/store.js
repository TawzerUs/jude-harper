const express = require('express');
const router = express.Router();
const { getDb } = require('../db/setup');

// Homepage
router.get('/', (req, res) => {
  const db = getDb();
  const featured = db.prepare('SELECT * FROM books WHERE active = 1 AND featured = 1 ORDER BY created_at DESC').all();
  const books = db.prepare('SELECT * FROM books WHERE active = 1 ORDER BY created_at DESC').all();
  db.close();
  res.render('home', { title: 'Jude Harper', featured, books });
});

// All books
router.get('/books', (req, res) => {
  const db = getDb();
  const books = db.prepare('SELECT * FROM books WHERE active = 1 ORDER BY created_at DESC').all();
  db.close();
  res.render('books', { title: 'All Books - Jude Harper', books });
});

// Single book page
router.get('/book/:slug', (req, res) => {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE slug = ? AND active = 1').get(req.params.slug);
  db.close();
  if (!book) return res.status(404).render('404', { title: 'Book Not Found' });
  res.render('book-detail', { title: `${book.title} - Jude Harper`, book });
});

// About page
router.get('/about', (req, res) => {
  res.render('about', { title: 'About - Jude Harper' });
});

// Newsletter signup
router.post('/subscribe', (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.redirect('/?error=Email is required');
  const db = getDb();
  try {
    db.prepare('INSERT OR IGNORE INTO subscribers (email, name) VALUES (?, ?)').run(email, name || null);
  } catch (e) { /* ignore duplicates */ }
  db.close();
  res.redirect('/?subscribed=1');
});

module.exports = router;
