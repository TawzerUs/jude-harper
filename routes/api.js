const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { supabase } = require('../db/setup');

// Stripe checkout session
router.post('/checkout', async (req, res) => {
  const { bookId } = req.body;
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_your_key_here') {
    return res.status(400).json({ error: 'Stripe not configured yet' });
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const { data: book } = await supabase.from('jh_books').select('*').eq('id', bookId).eq('active', true).single();

  if (!book) return res.status(404).json({ error: 'Book not found' });

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: book.title, description: book.description || undefined },
        unit_amount: Math.round(book.price * 100),
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${process.env.SITE_URL}/api/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_URL}/book/${book.slug}`,
    metadata: { book_id: book.id.toString() },
  });

  res.json({ url: session.url });
});

// Success callback
router.get('/success', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id || !process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_your_key_here') {
    return res.redirect('/?error=payment');
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const session = await stripe.checkout.sessions.retrieve(session_id);

  if (session.payment_status === 'paid') {
    const downloadToken = crypto.randomBytes(32).toString('hex');
    await supabase.from('jh_orders').insert({
      book_id: parseInt(session.metadata.book_id),
      email: session.customer_details.email,
      stripe_session_id: session.id,
      stripe_payment_id: session.payment_intent,
      amount: session.amount_total / 100,
      status: 'completed',
      download_token: downloadToken,
      download_count: 0
    });
    return res.redirect(`/api/download/${downloadToken}`);
  }
  res.redirect('/?error=payment');
});

// Download with token
router.get('/download/:token', async (req, res) => {
  const { data: order } = await supabase.from('jh_orders').select('*, jh_books(*)').eq('download_token', req.params.token).eq('status', 'completed').single();

  if (!order || !order.jh_books?.file_path) {
    return res.status(404).render('404', { title: 'Download Not Found' });
  }

  if (order.download_count >= 5) {
    return res.status(403).send('Download limit reached. Contact support.');
  }

  await supabase.from('jh_orders').update({ download_count: order.download_count + 1 }).eq('id', order.id);

  // Download from Supabase Storage
  const { data, error } = await supabase.storage.from('jh-uploads').download(order.jh_books.file_path);
  if (error || !data) return res.status(404).render('404', { title: 'File Not Found' });

  const buffer = Buffer.from(await data.arrayBuffer());
  res.set('Content-Disposition', `attachment; filename="${order.jh_books.title}.pdf"`);
  res.set('Content-Type', 'application/pdf');
  res.send(buffer);
});

module.exports = router;
