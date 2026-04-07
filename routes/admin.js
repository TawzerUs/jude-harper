const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../db/setup');

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, crypto.randomBytes(8).toString('hex') + ext);
  }
});
const upload = multer({ storage });

// Auth middleware
function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

// Login
router.get('/login', (req, res) => {
  res.render('admin/login', { title: 'Admin Login', error: null });
});

router.post('/login', (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('admin/login', { title: 'Admin Login', error: 'Invalid password' });
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Dashboard
router.get('/', requireAdmin, (req, res) => {
  const db = getDb();
  const books = db.prepare('SELECT * FROM books ORDER BY created_at DESC').all();
  const orderCount = db.prepare('SELECT COUNT(*) as count FROM orders WHERE status = ?').get('completed')?.count || 0;
  const subscriberCount = db.prepare('SELECT COUNT(*) as count FROM subscribers').get()?.count || 0;
  const revenue = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM orders WHERE status = ?').get('completed')?.total || 0;
  db.close();
  res.render('admin/dashboard', { title: 'Admin Dashboard', books, orderCount, subscriberCount, revenue });
});

// Add book form
router.get('/books/new', requireAdmin, (req, res) => {
  res.render('admin/book-form', { title: 'Add Book', book: null });
});

// Edit book form
router.get('/books/:id/edit', requireAdmin, (req, res) => {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  db.close();
  if (!book) return res.redirect('/admin');
  res.render('admin/book-form', { title: 'Edit Book', book });
});

// Create/Update book
router.post('/books', requireAdmin, upload.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]), (req, res) => {
  const { title, slug, description, long_description, price, category, featured, active, book_id } = req.body;
  const db = getDb();

  const cover_image = req.files?.cover?.[0]?.filename || null;
  const file_path = req.files?.file?.[0]?.filename || null;

  if (book_id) {
    // Update
    let query = 'UPDATE books SET title=?, slug=?, description=?, long_description=?, price=?, category=?, featured=?, active=?';
    const params = [title, slug, description, long_description, price, category, featured ? 1 : 0, active ? 1 : 0];
    if (cover_image) { query += ', cover_image=?'; params.push(cover_image); }
    if (file_path) { query += ', file_path=?'; params.push(file_path); }
    query += ' WHERE id=?';
    params.push(book_id);
    db.prepare(query).run(...params);
  } else {
    // Insert
    db.prepare(`INSERT INTO books (title, slug, description, long_description, price, cover_image, file_path, category, featured, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      title, slug, description, long_description, price, cover_image, file_path, category, featured ? 1 : 0, active ? 1 : 0
    );
  }
  db.close();
  res.redirect('/admin');
});

// Delete book
router.post('/books/:id/delete', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM books WHERE id = ?').run(req.params.id);
  db.close();
  res.redirect('/admin');
});

// Orders list
router.get('/orders', requireAdmin, (req, res) => {
  const db = getDb();
  const orders = db.prepare(`
    SELECT orders.*, books.title as book_title
    FROM orders JOIN books ON orders.book_id = books.id
    ORDER BY orders.created_at DESC
  `).all();
  db.close();
  res.render('admin/orders', { title: 'Orders', orders });
});

// Subscribers list
router.get('/subscribers', requireAdmin, (req, res) => {
  const db = getDb();
  const subscribers = db.prepare('SELECT * FROM subscribers ORDER BY created_at DESC').all();
  db.close();
  res.render('admin/subscribers', { title: 'Subscribers', subscribers });
});

module.exports = router;
