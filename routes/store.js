const express = require('express');
const router = express.Router();
const { getDb } = require('../db/setup');

// Homepage
router.get('/', (req, res) => {
  const db = getDb();
  const featured = db.all('books', b => b.active === 1 && b.featured === 1).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const books = db.all('books', b => b.active === 1).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.render('home', { title: 'Jude Harper', featured, books });
});

// All books
router.get('/books', (req, res) => {
  const db = getDb();
  const books = db.all('books', b => b.active === 1).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.render('books', { title: 'All Books - Jude Harper', books });
});

// Single book page
router.get('/book/:slug', (req, res) => {
  const db = getDb();
  const book = db.get('books', b => b.slug === req.params.slug && b.active === 1);
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
  const existing = db.get('subscribers', s => s.email === email);
  if (!existing) {
    db.insert('subscribers', { email, name: name || null });
  }
  res.redirect('/?subscribed=1');
});

module.exports = router;
