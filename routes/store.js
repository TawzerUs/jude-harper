const express = require('express');
const router = express.Router();
const { supabase } = require('../db/setup');

// Homepage
router.get('/', async (req, res) => {
  const { data: featured } = await supabase.from('jh_books').select('*').eq('active', true).eq('featured', true).order('created_at', { ascending: false });
  const { data: books } = await supabase.from('jh_books').select('*').eq('active', true).order('created_at', { ascending: false });
  res.render('home', { title: 'Jude Harper', featured: featured || [], books: books || [] });
});

// All books
router.get('/books', async (req, res) => {
  const { data: books } = await supabase.from('jh_books').select('*').eq('active', true).order('created_at', { ascending: false });
  res.render('books', { title: 'All Books - Jude Harper', books: books || [] });
});

// Single book page with gallery
router.get('/book/:slug', async (req, res) => {
  const { data: book } = await supabase.from('jh_books').select('*').eq('slug', req.params.slug).eq('active', true).single();
  if (!book) return res.status(404).render('404', { title: 'Book Not Found' });

  const { data: gallery } = await supabase.from('jh_book_gallery').select('*').eq('book_id', book.id).order('sort_order', { ascending: true });

  res.render('book-detail', { title: `${book.title} - Jude Harper`, book, gallery: gallery || [] });
});

// About page
router.get('/about', (req, res) => {
  res.render('about', { title: 'About - Jude Harper' });
});

// Newsletter signup
router.post('/subscribe', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.redirect('/?error=Email is required');
  await supabase.from('jh_subscribers').upsert({ email, name: name || null }, { onConflict: 'email' });
  res.redirect('/?subscribed=1');
});

module.exports = router;
