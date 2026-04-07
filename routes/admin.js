const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../db/setup');

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join('/tmp')),
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

// Debug - remove later
router.get('/debug-env', (req, res) => {
  res.json({
    hasAdminPw: !!process.env.ADMIN_PASSWORD,
    adminPwLength: (process.env.ADMIN_PASSWORD || '').length,
    vercel: process.env.VERCEL,
    nodeEnv: process.env.NODE_ENV
  });
});

router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
  const adminPw = process.env.ADMIN_PASSWORD || 'admin123';
  const inputPw = req.body?.password || '';
  if (inputPw === adminPw) {
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
  const books = db.all('books').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const orderCount = db.count('orders', o => o.status === 'completed');
  const subscriberCount = db.count('subscribers');
  const revenue = db.sum('orders', 'amount', o => o.status === 'completed');
  res.render('admin/dashboard', { title: 'Admin Dashboard', books, orderCount, subscriberCount, revenue });
});

// Add book form
router.get('/books/new', requireAdmin, (req, res) => {
  res.render('admin/book-form', { title: 'Add Book', book: null });
});

// Edit book form
router.get('/books/:id/edit', requireAdmin, (req, res) => {
  const db = getDb();
  const book = db.get('books', b => b.id === parseInt(req.params.id));
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
    const updates = {
      title, slug, description, long_description,
      price: parseFloat(price),
      category,
      featured: featured ? 1 : 0,
      active: active ? 1 : 0
    };
    if (cover_image) updates.cover_image = cover_image;
    if (file_path) updates.file_path = file_path;
    db.update('books', parseInt(book_id), updates);
  } else {
    db.insert('books', {
      title, slug, description, long_description,
      price: parseFloat(price),
      cover_image, file_path, category,
      featured: featured ? 1 : 0,
      active: active ? 1 : 0
    });
  }
  res.redirect('/admin');
});

// Delete book
router.post('/books/:id/delete', requireAdmin, (req, res) => {
  const db = getDb();
  db.delete('books', parseInt(req.params.id));
  res.redirect('/admin');
});

// Orders list
router.get('/orders', requireAdmin, (req, res) => {
  const db = getDb();
  const orders = db.all('orders').sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(order => {
    const book = db.get('books', b => b.id === order.book_id);
    return { ...order, book_title: book?.title || 'Unknown' };
  });
  res.render('admin/orders', { title: 'Orders', orders });
});

// Subscribers list
router.get('/subscribers', requireAdmin, (req, res) => {
  const db = getDb();
  const subscribers = db.all('subscribers').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.render('admin/subscribers', { title: 'Subscribers', subscribers });
});

module.exports = router;
