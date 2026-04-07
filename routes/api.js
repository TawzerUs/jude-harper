const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDb } = require('../db/setup');

// Stripe checkout session (only if Stripe is configured)
router.post('/checkout', async (req, res) => {
  const { bookId } = req.body;
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_your_key_here') {
    return res.status(400).json({ error: 'Stripe not configured' });
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ? AND active = 1').get(bookId);
  db.close();

  if (!book) return res.status(404).json({ error: 'Book not found' });

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: book.title,
          description: book.description || undefined,
          images: book.cover_image ? [`${process.env.SITE_URL}/uploads/${book.cover_image}`] : undefined,
        },
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
    const db = getDb();
    const downloadToken = crypto.randomBytes(32).toString('hex');
    db.prepare(`INSERT INTO orders (book_id, email, stripe_session_id, stripe_payment_id, amount, status, download_token)
      VALUES (?, ?, ?, ?, ?, 'completed', ?)`).run(
      session.metadata.book_id,
      session.customer_details.email,
      session.id,
      session.payment_intent,
      session.amount_total / 100,
      downloadToken
    );
    db.close();
    return res.redirect(`/api/download/${downloadToken}`);
  }
  res.redirect('/?error=payment');
});

// Download with token
router.get('/download/:token', (req, res) => {
  const db = getDb();
  const order = db.prepare(`
    SELECT orders.*, books.file_path, books.title
    FROM orders JOIN books ON orders.book_id = books.id
    WHERE orders.download_token = ? AND orders.status = 'completed'
  `).get(req.params.token);

  if (!order || !order.file_path) {
    db.close();
    return res.status(404).render('404', { title: 'Download Not Found' });
  }

  // Limit downloads to 5
  if (order.download_count >= 5) {
    db.close();
    return res.status(403).send('Download limit reached. Contact support.');
  }

  db.prepare('UPDATE orders SET download_count = download_count + 1 WHERE id = ?').run(order.id);
  db.close();

  const path = require('path');
  res.download(path.join(__dirname, '..', 'uploads', order.file_path), `${order.title}.pdf`);
});

module.exports = router;
