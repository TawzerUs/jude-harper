const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { supabase } = require('../db/setup');

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MIN = 15;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/tmp'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, crypto.randomBytes(8).toString('hex') + ext);
  }
});
const upload = multer({ storage });

function requireAdmin(req, res, next) {
  if (req.session.isAdmin && req.session.adminEmail) return next();
  res.redirect('/admin/login');
}

async function uploadToStorage(filePath, storagePath, contentType) {
  const fileBuffer = fs.readFileSync(filePath);
  await supabase.storage.from('jh-uploads').upload(storagePath, fileBuffer, { contentType, upsert: true });
  const { data } = supabase.storage.from('jh-uploads').getPublicUrl(storagePath);
  return data.publicUrl;
}

// Login
router.get('/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Admin Login', error: null });
});

router.post('/login', express.urlencoded({ extended: true }), async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password || '';
  const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';

  if (!email || !password) {
    return res.render('admin/login', { title: 'Admin Login', error: 'Email and password required' });
  }

  // Find admin user
  const { data: user } = await supabase.from('jh_admin_users').select('*').eq('email', email).single();

  if (!user) {
    await supabase.from('jh_admin_login_log').insert({ email, ip_address: ip, success: false });
    return res.render('admin/login', { title: 'Admin Login', error: 'Invalid credentials' });
  }

  // Check if account is locked
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minsLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    return res.render('admin/login', { title: 'Admin Login', error: `Account locked. Try again in ${minsLeft} minutes.` });
  }

  // Verify password
  const valid = await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    const attempts = (user.login_attempts || 0) + 1;
    const updates = { login_attempts: attempts };
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      updates.locked_until = new Date(Date.now() + LOCK_DURATION_MIN * 60000).toISOString();
      updates.login_attempts = 0;
    }
    await supabase.from('jh_admin_users').update(updates).eq('id', user.id);
    await supabase.from('jh_admin_login_log').insert({ email, ip_address: ip, success: false });

    const remaining = MAX_LOGIN_ATTEMPTS - attempts;
    const msg = remaining > 0 ? `Invalid credentials. ${remaining} attempts remaining.` : `Too many failed attempts. Account locked for ${LOCK_DURATION_MIN} minutes.`;
    return res.render('admin/login', { title: 'Admin Login', error: msg });
  }

  // Success — reset attempts, set session
  await supabase.from('jh_admin_users').update({ login_attempts: 0, locked_until: null, last_login: new Date().toISOString() }).eq('id', user.id);
  await supabase.from('jh_admin_login_log').insert({ email, ip_address: ip, success: true });

  req.session.isAdmin = true;
  req.session.adminEmail = user.email;
  req.session.adminName = user.name;
  req.session.adminRole = user.role;

  res.redirect('/admin');
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
  { name: 'lulu_interior', maxCount: 1 },
  { name: 'audiobook_file', maxCount: 1 },
  { name: 'audiobook_sample', maxCount: 1 }
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
      has_audiobook: !!b.has_audiobook,
      has_paperback: !!b.has_paperback,
      audiobook_price: b.audiobook_price ? parseFloat(b.audiobook_price) : null,
      audiobook_narrator: b.audiobook_narrator || null,
      audiobook_duration: b.audiobook_duration || null,
      audiobook_format: b.audiobook_format || 'MP3',
      audiobook_quality: b.audiobook_quality || '192kbps',
      audiobook_chapters: b.audiobook_chapters ? parseInt(b.audiobook_chapters) : null,
      audiobook_chapter_list: b.audiobook_chapter_list || null,
      paperback_price: b.paperback_price ? parseFloat(b.paperback_price) : null,
      // Product details
      pages: b.pages ? parseInt(b.pages) : null,
      language: b.language || 'English',
      isbn: b.isbn || null,
      dimensions: b.dimensions || null,
      weight: b.weight || null,
      publisher: b.publisher || 'Independently published',
      publication_date: b.publication_date || null,
      // Lulu fields (only relevant for paperback)
      lulu_product_id: b.has_paperback ? (b.lulu_product_id || null) : null,
      lulu_binding: b.has_paperback ? (b.lulu_binding || 'Paperback Perfect Bound') : null,
      lulu_paper_type: b.has_paperback ? (b.lulu_paper_type || '60# White') : null,
      lulu_trim_size: b.has_paperback ? (b.lulu_trim_size || '6 x 9') : null,
      lulu_interior_color: b.has_paperback ? (b.lulu_interior_color || 'Standard Black & White') : null,
      lulu_cover_finish: b.has_paperback ? (b.lulu_cover_finish || 'Matte') : null,
      lulu_print_cost: b.has_paperback && b.lulu_print_cost ? parseFloat(b.lulu_print_cost) : null,
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
    } else if (b.lulu_cover_path) {
      bookData.lulu_cover_pdf = b.lulu_cover_path;
    }

    // Upload Lulu interior PDF
    if (req.files?.lulu_interior?.[0]) {
      const f = req.files.lulu_interior[0];
      await supabase.storage.from('jh-uploads').upload(`lulu/${f.filename}`, fs.readFileSync(f.path), { contentType: f.mimetype });
      bookData.lulu_interior_pdf = `lulu/${f.filename}`;
    } else if (b.lulu_interior_path) {
      bookData.lulu_interior_pdf = b.lulu_interior_path;
    }

    // Upload audiobook file (server-side for small files, or use client-side path)
    if (req.files?.audiobook_file?.[0]) {
      const f = req.files.audiobook_file[0];
      await supabase.storage.from('jh-uploads').upload(`audiobooks/${f.filename}`, fs.readFileSync(f.path), { contentType: f.mimetype });
      bookData.audiobook_file = `audiobooks/${f.filename}`;
    } else if (b.audiobook_file_path) {
      bookData.audiobook_file = b.audiobook_file_path;
    }

    // Upload audiobook sample clip
    if (req.files?.audiobook_sample?.[0]) {
      const f = req.files.audiobook_sample[0];
      await supabase.storage.from('jh-uploads').upload(`audiobooks/samples/${f.filename}`, fs.readFileSync(f.path), { contentType: f.mimetype });
      bookData.audiobook_sample = `audiobooks/samples/${f.filename}`;
    } else if (b.audiobook_sample_path) {
      bookData.audiobook_sample = b.audiobook_sample_path;
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

// Fulfillment & Tracking
router.get('/fulfillment', requireAdmin, async (req, res) => {
  const filter = req.query.filter;
  let query = supabase.from('jh_orders').select('*, jh_books(title)').order('created_at', { ascending: false });
  if (filter === 'pending') query = query.eq('fulfillment_status', 'pending');
  else if (filter === 'shipped') query = query.eq('fulfillment_status', 'shipped');
  else if (filter === 'delivered') query = query.eq('fulfillment_status', 'delivered');
  const { data: orders } = await query;
  const mapped = (orders || []).map(o => ({ ...o, book_title: o.jh_books?.title || 'Unknown' }));
  res.render('admin/fulfillment', { title: 'Fulfillment', orders: mapped, filter: filter || 'all' });
});

router.post('/fulfillment/:id/update', requireAdmin, async (req, res) => {
  const updates = { fulfillment_status: req.body.fulfillment_status };
  if (req.body.tracking_number) {
    updates.tracking_number = req.body.tracking_number;
    updates.tracking_carrier = req.body.tracking_carrier || 'USPS';
  }
  if (req.body.fulfillment_status === 'shipped') updates.shipped_at = new Date().toISOString();
  if (req.body.fulfillment_status === 'delivered') updates.delivered_at = new Date().toISOString();
  await supabase.from('jh_orders').update(updates).eq('id', req.params.id);
  res.redirect('/admin/fulfillment');
});

// Bundles management
router.get('/bundles', requireAdmin, async (req, res) => {
  const { data: bundles } = await supabase.from('jh_bundles').select('*').order('created_at', { ascending: false });
  for (const b of (bundles || [])) {
    const { count } = await supabase.from('jh_bundle_items').select('*', { count: 'exact', head: true }).eq('bundle_id', b.id);
    b.item_count = count || 0;
  }
  res.render('admin/bundles', { title: 'Bundles', bundles: bundles || [] });
});

router.get('/bundles/new', requireAdmin, async (req, res) => {
  const { data: books } = await supabase.from('jh_books').select('*').eq('active', true).order('title');
  res.render('admin/bundle-form', { title: 'Create Bundle', bundle: null, books: books || [] });
});

router.get('/bundles/:id/edit', requireAdmin, async (req, res) => {
  const { data: bundle } = await supabase.from('jh_bundles').select('*').eq('id', req.params.id).single();
  if (!bundle) return res.redirect('/admin/bundles');
  const { data: items } = await supabase.from('jh_bundle_items').select('*').eq('bundle_id', bundle.id);
  bundle.items = items || [];
  const { data: books } = await supabase.from('jh_books').select('*').eq('active', true).order('title');
  res.render('admin/bundle-form', { title: 'Edit Bundle', bundle, books: books || [] });
});

router.post('/bundles', requireAdmin, upload.single('cover'), async (req, res) => {
  try {
    const b = req.body;
    const bundleData = {
      title: b.title,
      slug: b.slug,
      description: b.description,
      price: parseFloat(b.price),
      original_price: b.original_price ? parseFloat(b.original_price) : null,
      discount_percent: b.discount_percent ? parseInt(b.discount_percent) : null,
      active: !!b.active,
      limited_offer: !!b.limited_offer,
    };

    if (req.file) {
      bundleData.cover_image = await uploadToStorage(req.file.path, `bundles/${req.file.filename}`, req.file.mimetype);
    }

    let bundleId = b.bundle_id ? parseInt(b.bundle_id) : null;

    if (bundleId) {
      await supabase.from('jh_bundles').update(bundleData).eq('id', bundleId);
      await supabase.from('jh_bundle_items').delete().eq('bundle_id', bundleId);
    } else {
      const { data } = await supabase.from('jh_bundles').insert(bundleData).select('id').single();
      if (data) bundleId = data.id;
    }

    // Save bundle items
    const items = Array.isArray(b['items[]']) ? b['items[]'] : (b['items[]'] ? [b['items[]']] : []);
    let sortOrder = 0;
    for (const item of items) {
      const [bookId, format] = item.split(':');
      await supabase.from('jh_bundle_items').insert({ bundle_id: bundleId, book_id: parseInt(bookId), format, sort_order: sortOrder++ });
    }

    res.redirect('/admin/bundles');
  } catch (err) {
    console.error('Bundle save error:', err);
    res.redirect('/admin/bundles');
  }
});

router.post('/bundles/:id/delete', requireAdmin, async (req, res) => {
  await supabase.from('jh_bundle_items').delete().eq('bundle_id', req.params.id);
  await supabase.from('jh_bundles').delete().eq('id', req.params.id);
  res.redirect('/admin/bundles');
});

module.exports = router;
