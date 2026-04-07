const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { supabase } = require('../db/setup');

// File upload config (to /tmp for now — later use Supabase Storage)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/tmp'),
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
router.get('/', requireAdmin, async (req, res) => {
  const { data: books } = await supabase.from('jh_books').select('*').order('created_at', { ascending: false });
  const { count: orderCount } = await supabase.from('jh_orders').select('*', { count: 'exact', head: true }).eq('status', 'completed');
  const { count: subscriberCount } = await supabase.from('jh_subscribers').select('*', { count: 'exact', head: true });
  const { data: revenueData } = await supabase.from('jh_orders').select('amount').eq('status', 'completed');
  const revenue = (revenueData || []).reduce((sum, o) => sum + parseFloat(o.amount), 0);

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    books: books || [],
    orderCount: orderCount || 0,
    subscriberCount: subscriberCount || 0,
    revenue
  });
});

// Add book form
router.get('/books/new', requireAdmin, (req, res) => {
  res.render('admin/book-form', { title: 'Add Book', book: null });
});

// Edit book form
router.get('/books/:id/edit', requireAdmin, async (req, res) => {
  const { data: book } = await supabase.from('jh_books').select('*').eq('id', req.params.id).single();
  if (!book) return res.redirect('/admin');
  res.render('admin/book-form', { title: 'Edit Book', book });
});

// Create/Update book
router.post('/books', requireAdmin, upload.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]), async (req, res) => {
  const { title, slug, description, long_description, price, category, featured, active, book_id } = req.body;

  let cover_image = null;
  let file_path = null;

  // Upload cover to Supabase Storage if provided
  if (req.files?.cover?.[0]) {
    const coverFile = req.files.cover[0];
    const fs = require('fs');
    const fileBuffer = fs.readFileSync(coverFile.path);
    const fileName = `covers/${coverFile.filename}`;
    await supabase.storage.from('jh-uploads').upload(fileName, fileBuffer, { contentType: coverFile.mimetype });
    const { data: urlData } = supabase.storage.from('jh-uploads').getPublicUrl(fileName);
    cover_image = urlData.publicUrl;
  }

  if (req.files?.file?.[0]) {
    const bookFile = req.files.file[0];
    const fs = require('fs');
    const fileBuffer = fs.readFileSync(bookFile.path);
    const fileName = `files/${bookFile.filename}`;
    await supabase.storage.from('jh-uploads').upload(fileName, fileBuffer, { contentType: bookFile.mimetype });
    file_path = fileName;
  }

  const bookData = {
    title, slug, description, long_description,
    price: parseFloat(price),
    category,
    featured: !!featured,
    active: !!active
  };
  if (cover_image) bookData.cover_image = cover_image;
  if (file_path) bookData.file_path = file_path;

  if (book_id) {
    const { error } = await supabase.from('jh_books').update(bookData).eq('id', book_id);
    if (error) console.error('Update book error:', error);
  } else {
    const { error } = await supabase.from('jh_books').insert(bookData);
    if (error) console.error('Insert book error:', error);
  }

  res.redirect('/admin');
});

// Delete book
router.post('/books/:id/delete', requireAdmin, async (req, res) => {
  await supabase.from('jh_books').delete().eq('id', req.params.id);
  res.redirect('/admin');
});

// Orders list
router.get('/orders', requireAdmin, async (req, res) => {
  const { data: orders } = await supabase.from('jh_orders').select('*, jh_books(title)').order('created_at', { ascending: false });
  const mapped = (orders || []).map(o => ({ ...o, book_title: o.jh_books?.title || 'Unknown' }));
  res.render('admin/orders', { title: 'Orders', orders: mapped });
});

// Subscribers list
router.get('/subscribers', requireAdmin, async (req, res) => {
  const { data: subscribers } = await supabase.from('jh_subscribers').select('*').order('created_at', { ascending: false });
  res.render('admin/subscribers', { title: 'Subscribers', subscribers: subscribers || [] });
});

module.exports = router;
