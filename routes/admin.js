const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { supabase } = require('../db/setup');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/tmp'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, crypto.randomBytes(8).toString('hex') + ext);
  }
});
const upload = multer({ storage });

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

// Helper: upload file to Supabase Storage
async function uploadToStorage(filePath, storagePath, contentType) {
  const fileBuffer = fs.readFileSync(filePath);
  await supabase.storage.from('jh-uploads').upload(storagePath, fileBuffer, { contentType, upsert: true });
  const { data } = supabase.storage.from('jh-uploads').getPublicUrl(storagePath);
  return data.publicUrl;
}

// Login
router.get('/login', (req, res) => {
  res.render('admin/login', { title: 'Admin Login', error: null });
});

router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
  const adminPw = process.env.ADMIN_PASSWORD || 'admin123';
  if ((req.body?.password || '') === adminPw) {
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
  res.render('admin/dashboard', { title: 'Admin Dashboard', books: books || [], orderCount: orderCount || 0, subscriberCount: subscriberCount || 0, revenue });
});

// New book form
router.get('/books/new', requireAdmin, (req, res) => {
  res.render('admin/book-form', { title: 'Add Book', book: null, gallery: [] });
});

// Edit book form
router.get('/books/:id/edit', requireAdmin, async (req, res) => {
  const { data: book } = await supabase.from('jh_books').select('*').eq('id', req.params.id).single();
  if (!book) return res.redirect('/admin');
  const { data: gallery } = await supabase.from('jh_book_gallery').select('*').eq('book_id', book.id).order('sort_order', { ascending: true });
  res.render('admin/book-form', { title: 'Edit Book', book, gallery: gallery || [] });
});

// Create/Update book
router.post('/books', requireAdmin, upload.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'file', maxCount: 1 },
  { name: 'gallery', maxCount: 10 },
  { name: 'lulu_cover', maxCount: 1 },
  { name: 'lulu_interior', maxCount: 1 }
]), async (req, res) => {
  try {
    const b = req.body;
    const bookData = {
      title: b.title,
      slug: b.slug,
      description: b.description,
      long_description: b.long_description,
      price: parseFloat(b.price),
      category: b.category,
      featured: !!b.featured,
      active: !!b.active,
      has_digital: !!b.has_digital,
      has_paperback: !!b.has_paperback,
      paperback_price: b.paperback_price ? parseFloat(b.paperback_price) : null,
      // Product details
      pages: b.pages ? parseInt(b.pages) : null,
      language: b.language || 'English',
      isbn: b.isbn || null,
      dimensions: b.dimensions || null,
      weight: b.weight || null,
      publisher: b.publisher || 'Independently published',
      publication_date: b.publication_date || null,
      // Lulu fields
      lulu_product_id: b.lulu_product_id || null,
      lulu_binding: b.lulu_binding || 'Paperback Perfect Bound',
      lulu_paper_type: b.lulu_paper_type || '60# White',
      lulu_trim_size: b.lulu_trim_size || '6 x 9',
      lulu_interior_color: b.lulu_interior_color || 'Standard Black & White',
      lulu_cover_finish: b.lulu_cover_finish || 'Matte',
      lulu_print_cost: b.lulu_print_cost ? parseFloat(b.lulu_print_cost) : null,
    };

    // Upload cover image
    if (req.files?.cover?.[0]) {
      const f = req.files.cover[0];
      bookData.cover_image = await uploadToStorage(f.path, `covers/${f.filename}`, f.mimetype);
    }

    // Upload digital file
    if (req.files?.file?.[0]) {
      const f = req.files.file[0];
      await supabase.storage.from('jh-uploads').upload(`files/${f.filename}`, fs.readFileSync(f.path), { contentType: f.mimetype });
      bookData.file_path = `files/${f.filename}`;
    }

    // Upload Lulu cover PDF
    if (req.files?.lulu_cover?.[0]) {
      const f = req.files.lulu_cover[0];
      await supabase.storage.from('jh-uploads').upload(`lulu/${f.filename}`, fs.readFileSync(f.path), { contentType: f.mimetype });
      bookData.lulu_cover_pdf = `lulu/${f.filename}`;
    }

    // Upload Lulu interior PDF
    if (req.files?.lulu_interior?.[0]) {
      const f = req.files.lulu_interior[0];
      await supabase.storage.from('jh-uploads').upload(`lulu/${f.filename}`, fs.readFileSync(f.path), { contentType: f.mimetype });
      bookData.lulu_interior_pdf = `lulu/${f.filename}`;
    }

    let bookId = b.book_id ? parseInt(b.book_id) : null;

    if (bookId) {
      const { error } = await supabase.from('jh_books').update(bookData).eq('id', bookId);
      if (error) console.error('Update book error:', error);
    } else {
      const { data, error } = await supabase.from('jh_books').insert(bookData).select('id').single();
      if (error) console.error('Insert book error:', error);
      if (data) bookId = data.id;
    }

    // Upload gallery images
    if (req.files?.gallery && bookId) {
      const { data: existing } = await supabase.from('jh_book_gallery').select('sort_order').eq('book_id', bookId).order('sort_order', { ascending: false }).limit(1);
      let sortOrder = (existing?.[0]?.sort_order || 0) + 1;

      for (const f of req.files.gallery) {
        const url = await uploadToStorage(f.path, `gallery/${f.filename}`, f.mimetype);
        const type = f.mimetype.startsWith('video/') ? 'video' : 'image';
        await supabase.from('jh_book_gallery').insert({ book_id: bookId, url, type, sort_order: sortOrder++ });
      }
    }

    res.redirect('/admin');
  } catch (err) {
    console.error('Book save error:', err);
    res.redirect('/admin');
  }
});

// Delete book
router.post('/books/:id/delete', requireAdmin, async (req, res) => {
  await supabase.from('jh_book_gallery').delete().eq('book_id', req.params.id);
  await supabase.from('jh_books').delete().eq('id', req.params.id);
  res.redirect('/admin');
});

// Orders
router.get('/orders', requireAdmin, async (req, res) => {
  const { data: orders } = await supabase.from('jh_orders').select('*, jh_books(title)').order('created_at', { ascending: false });
  const mapped = (orders || []).map(o => ({ ...o, book_title: o.jh_books?.title || 'Unknown' }));
  res.render('admin/orders', { title: 'Orders', orders: mapped });
});

// Subscribers
router.get('/subscribers', requireAdmin, async (req, res) => {
  const { data: subscribers } = await supabase.from('jh_subscribers').select('*').order('created_at', { ascending: false });
  res.render('admin/subscribers', { title: 'Subscribers', subscribers: subscribers || [] });
});

module.exports = router;
