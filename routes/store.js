const express = require('express');
const router = express.Router();
const { supabase } = require('../db/setup');

// Homepage
router.get('/', async (req, res) => {
  const { data: featured } = await supabase.from('jh_books').select('*').eq('active', true).eq('featured', true).order('created_at', { ascending: false });
  const { data: books } = await supabase.from('jh_books').select('*').eq('active', true).order('created_at', { ascending: false });
  res.render('home', { title: 'Jude Harper', featured: featured || [], books: books || [], subscribed: req.query.subscribed === '1' });
});

// Shop page with tabs
router.get('/shop', async (req, res) => {
  const { data: allProducts } = await supabase.from('jh_books').select('*').eq('active', true).order('created_at', { ascending: false });
  const books = (allProducts || []).filter(b => b.has_digital || b.has_paperback);
  const audiobooks = (allProducts || []).filter(b => b.has_audiobook);
  const { data: bundles } = await supabase.from('jh_bundles').select('*').eq('active', true).order('created_at', { ascending: false });
  res.render('shop', { title: 'Shop - Jude Harper', allProducts: allProducts || [], books, audiobooks, bundles: bundles || [] });
});

// All books (only products with digital/paperback — not audiobook-only)
router.get('/books', async (req, res) => {
  const { data: allBooks } = await supabase.from('jh_books').select('*').eq('active', true).order('created_at', { ascending: false });
  const books = (allBooks || []).filter(b => b.has_digital || b.has_paperback);
  res.render('books', { title: 'All Books - Jude Harper', books });
});

// Single book page with gallery
router.get('/book/:slug', async (req, res) => {
  const { data: book } = await supabase.from('jh_books').select('*').eq('slug', req.params.slug).eq('active', true).single();
  if (!book) return res.status(404).render('404', { title: 'Book Not Found' });
  const { data: gallery } = await supabase.from('jh_book_gallery').select('*').eq('book_id', book.id).order('sort_order', { ascending: true });

  // Get sample audio URL if exists
  let sampleUrl = null;
  if (book.audiobook_sample) {
    const { data: sData } = supabase.storage.from('jh-uploads').getPublicUrl(book.audiobook_sample);
    sampleUrl = sData?.publicUrl;
  }

  res.render('book-detail', { title: `${book.title} - Jude Harper`, book, gallery: gallery || [], sampleUrl, reqFormat: req.query.format || null });
});

// Audiobooks page
router.get('/audiobooks', async (req, res) => {
  const { data: books } = await supabase.from('jh_books').select('*').eq('active', true).eq('has_audiobook', true).order('created_at', { ascending: false });
  res.render('audiobooks', { title: 'Audiobooks - Jude Harper', books: books || [] });
});

// Audiobook player (requires purchase token)
router.get('/listen/:token', async (req, res) => {
  const { data: order } = await supabase.from('jh_orders').select('*, jh_books(*)').eq('download_token', req.params.token).eq('status', 'completed').single();
  if (!order || order.format !== 'audiobook' || !order.jh_books?.audiobook_file) {
    return res.status(404).render('404', { title: 'Not Found' });
  }
  res.render('player', { title: `Listen: ${order.jh_books.title}`, book: order.jh_books, order, token: req.params.token });
});

// Bundles page
router.get('/bundles', async (req, res) => {
  const { data: bundles } = await supabase.from('jh_bundles').select('*').eq('active', true).order('created_at', { ascending: false });

  // Load items for each bundle
  for (const bundle of (bundles || [])) {
    const { data: items } = await supabase.from('jh_bundle_items').select('*, jh_books(title, cover_image)').eq('bundle_id', bundle.id).order('sort_order', { ascending: true });
    bundle.items = (items || []).map(i => ({ ...i, book_title: i.jh_books?.title, cover_image: i.jh_books?.cover_image }));
  }

  res.render('bundles', { title: 'Bundles & Offers - Jude Harper', bundles: bundles || [] });
});

// Order tracking
router.get('/track', async (req, res) => {
  const email = req.query.email;
  let orders = [];
  if (email) {
    const { data } = await supabase.from('jh_orders').select('*, jh_books(title, cover_image)').eq('email', email).order('created_at', { ascending: false });
    orders = data || [];
  }
  res.render('track', { title: 'Track Order - Jude Harper', orders, email });
});

// About page
router.get('/about', (req, res) => {
  res.render('about', { title: 'About - Jude Harper' });
});

// Legal pages
router.get('/privacy', (req, res) => {
  res.render('privacy', { title: 'Privacy Policy - Jude Harper' });
});
router.get('/terms', (req, res) => {
  res.render('terms', { title: 'Terms of Service - Jude Harper' });
});
router.get('/shipping', (req, res) => {
  res.render('shipping', { title: 'Shipping & Delivery - Jude Harper' });
});

// Newsletter signup
router.post('/subscribe', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.redirect('/?error=Email is required');
  await supabase.from('jh_subscribers').upsert({ email, name: name || null }, { onConflict: 'email' });
  res.redirect('/?subscribed=1');
});

module.exports = router;
