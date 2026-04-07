const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { supabase } = require('../db/setup');

// Stripe checkout session
router.post('/checkout', async (req, res) => {
  const { bookId, format = 'digital' } = req.body;
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_your_key_here') {
    return res.status(400).json({ error: 'Stripe not configured yet' });
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const { data: book } = await supabase.from('jh_books').select('*').eq('id', bookId).eq('active', true).single();
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const price = format === 'paperback' && book.paperback_price ? book.paperback_price : book.price;

  const sessionConfig = {
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${book.title} (${format === 'paperback' ? 'Paperback' : 'Digital PDF'})`,
          description: book.description || undefined,
        },
        unit_amount: Math.round(parseFloat(price) * 100),
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${process.env.SITE_URL}/api/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_URL}/book/${book.slug}`,
    metadata: { book_id: book.id.toString(), format },
  };

  // Collect shipping address for paperback orders
  if (format === 'paperback') {
    sessionConfig.shipping_address_collection = {
      allowed_countries: ['US', 'CA', 'GB', 'FR', 'DE', 'AU', 'NZ', 'IE', 'NL', 'BE', 'ES', 'IT', 'PT', 'AT', 'CH', 'SE', 'NO', 'DK', 'FI']
    };
  }

  const session = await stripe.checkout.sessions.create(sessionConfig);
  res.json({ url: session.url });
});

// Success callback
router.get('/success', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id || !process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_your_key_here') {
    return res.redirect('/?error=payment');
  }

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status === 'paid') {
      const format = session.metadata.format || 'digital';
      const downloadToken = crypto.randomBytes(32).toString('hex');

      const orderData = {
        book_id: parseInt(session.metadata.book_id),
        email: session.customer_details.email,
        stripe_session_id: session.id,
        stripe_payment_id: session.payment_intent,
        amount: session.amount_total / 100,
        status: 'completed',
        download_token: downloadToken,
        download_count: 0,
        format,
      };

      // Store shipping address for paperback
      if (format === 'paperback' && session.shipping_details) {
        orderData.shipping_address = session.shipping_details;
      }

      const { data: order } = await supabase.from('jh_orders').insert(orderData).select().single();

      // For paperback: create Lulu print job
      if (format === 'paperback') {
        try {
          await createLuluPrintJob(order);
        } catch (luluErr) {
          console.error('Lulu print job error:', luluErr);
        }
      }

      if (format === 'digital') {
        return res.redirect(`/api/download/${downloadToken}`);
      } else {
        // For paperback, show a thank you page
        return res.redirect(`/api/order-confirmed/${downloadToken}`);
      }
    }
  } catch (err) {
    console.error('Payment success error:', err);
  }
  res.redirect('/?error=payment');
});

// Create Lulu print job
async function createLuluPrintJob(order) {
  const { data: settings } = await supabase.from('jh_settings').select('*');
  const luluKey = (settings || []).find(s => s.key === 'lulu_api_key')?.value;
  if (!luluKey) return console.log('Lulu API key not configured');

  const { data: book } = await supabase.from('jh_books').select('*').eq('id', order.book_id).single();
  if (!book || !book.lulu_cover_pdf || !book.lulu_interior_pdf) return console.log('Lulu files not configured for book');

  const { data: coverUrl } = supabase.storage.from('jh-uploads').getPublicUrl(book.lulu_cover_pdf);
  const { data: interiorUrl } = supabase.storage.from('jh-uploads').getPublicUrl(book.lulu_interior_pdf);

  const shipping = order.shipping_address?.address || {};

  const printJob = {
    line_items: [{
      title: book.title,
      cover: coverUrl.publicUrl,
      interior: interiorUrl.publicUrl,
      pod_package_id: buildPodPackageId(book),
      quantity: 1,
    }],
    shipping_address: {
      name: order.shipping_address?.name || order.email,
      street1: shipping.line1 || '',
      street2: shipping.line2 || '',
      city: shipping.city || '',
      state_code: shipping.state || '',
      country_code: shipping.country || 'US',
      postcode: shipping.postal_code || '',
    },
    shipping_level: 'MAIL',
  };

  const response = await fetch('https://api.lulu.com/print-jobs/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${luluKey}`,
    },
    body: JSON.stringify(printJob),
  });

  const result = await response.json();
  if (result.id) {
    await supabase.from('jh_orders').update({ lulu_print_job_id: result.id.toString() }).eq('id', order.id);
    console.log('Lulu print job created:', result.id);
  } else {
    console.error('Lulu API error:', result);
  }
}

// Build Lulu POD package ID from book settings
function buildPodPackageId(book) {
  // Default: 6x9 paperback perfect bound, standard BW, 60# white
  // Format: size_binding_color_paper e.g. "0600X0900BWSTDPB060UW444"
  // This is simplified — real implementation should map to Lulu's pod_package_id catalog
  return book.lulu_product_id || '0600X0900BWSTDPB060UW444';
}

// Download digital file
router.get('/download/:token', async (req, res) => {
  const { data: order } = await supabase.from('jh_orders').select('*, jh_books(*)').eq('download_token', req.params.token).eq('status', 'completed').single();

  if (!order || !order.jh_books?.file_path) {
    return res.status(404).render('404', { title: 'Download Not Found' });
  }

  if (order.download_count >= 5) {
    return res.status(403).send('Download limit reached. Contact support.');
  }

  await supabase.from('jh_orders').update({ download_count: order.download_count + 1 }).eq('id', order.id);

  const { data, error } = await supabase.storage.from('jh-uploads').download(order.jh_books.file_path);
  if (error || !data) return res.status(404).render('404', { title: 'File Not Found' });

  const buffer = Buffer.from(await data.arrayBuffer());
  res.set('Content-Disposition', `attachment; filename="${order.jh_books.title}.pdf"`);
  res.set('Content-Type', 'application/pdf');
  res.send(buffer);
});

// Order confirmed (for paperback)
router.get('/order-confirmed/:token', async (req, res) => {
  const { data: order } = await supabase.from('jh_orders').select('*, jh_books(title)').eq('download_token', req.params.token).single();
  if (!order) return res.status(404).render('404', { title: 'Order Not Found' });

  res.send(`
    <!DOCTYPE html><html><head><title>Order Confirmed</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
    </head><body class="bg-white min-h-screen flex items-center justify-center font-[Inter]">
    <div class="text-center max-w-md px-6">
      <div class="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg class="w-8 h-8 text-green-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
      </div>
      <h1 class="font-[Playfair_Display] text-3xl font-bold mb-3">Order Confirmed!</h1>
      <p class="text-gray-600 mb-2">Thank you for ordering <strong>${order.jh_books?.title || 'your book'}</strong></p>
      <p class="text-gray-500 text-sm mb-6">Your paperback will be printed and shipped within 5-10 business days. You'll receive tracking info at <strong>${order.email}</strong>.</p>
      <a href="/" class="inline-block bg-[#FF5C00] text-white px-8 py-3 rounded-full font-semibold hover:bg-orange-600 transition">Back to Store</a>
    </div></body></html>
  `);
});

module.exports = router;
