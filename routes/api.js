const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { supabase } = require('../db/setup');

// Signed upload URL for large files (bypasses Vercel 4.5MB limit)
router.post('/upload-url', async (req, res) => {
  // Only allow admins
  if (!req.session?.isAdmin) return res.status(401).json({ error: 'Unauthorized' });

  const { filename, folder } = req.body;
  if (!filename || !folder) return res.status(400).json({ error: 'filename and folder required' });

  const ext = filename.split('.').pop();
  const safeName = crypto.randomBytes(8).toString('hex') + '.' + ext;
  const path = `${folder}/${safeName}`;

  const { data, error } = await supabase.storage.from('jh-uploads').createSignedUploadUrl(path);
  if (error) return res.status(500).json({ error: error.message });

  const { data: urlData } = supabase.storage.from('jh-uploads').getPublicUrl(path);

  res.json({ signedUrl: data.signedUrl, token: data.token, path, publicUrl: urlData.publicUrl });
});

// Resolve Stripe key from various possible env var names
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || process.env.STRIPE_KEY;

// Stripe checkout session
router.post('/checkout', async (req, res) => {
  const { bookId, format = 'digital' } = req.body;
  if (!STRIPE_KEY || STRIPE_KEY === 'sk_test_your_key_here') {
    return res.status(400).json({ error: 'Stripe not configured yet' });
  }

  const stripe = require('stripe')(STRIPE_KEY);
  const { data: book } = await supabase.from('jh_books').select('*').eq('id', bookId).eq('active', true).single();
  if (!book) return res.status(404).json({ error: 'Book not found' });

  let price = book.price;
  if (format === 'paperback' && book.paperback_price) price = book.paperback_price;
  if (format === 'audiobook' && book.audiobook_price) price = book.audiobook_price;

  const sessionConfig = {
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${book.title} (${format === 'paperback' ? 'Paperback' : format === 'audiobook' ? 'Audiobook' : 'Digital PDF'})`,
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
  if (!session_id || !STRIPE_KEY) {
    return res.redirect('/?error=payment');
  }

  try {
    const stripe = require('stripe')(STRIPE_KEY);
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

      if (format === 'audiobook') {
        return res.redirect(`/listen/${downloadToken}`);
      } else if (format === 'digital') {
        return res.redirect(`/api/download/${downloadToken}`);
      } else {
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

  const filePath = order.format === 'audiobook' ? order.jh_books?.audiobook_file : order.jh_books?.file_path;
  if (!order || !filePath) {
    return res.status(404).render('404', { title: 'Download Not Found' });
  }

  if (order.download_count >= 5) {
    return res.status(403).send('Download limit reached. Contact support.');
  }

  await supabase.from('jh_orders').update({ download_count: order.download_count + 1 }).eq('id', order.id);

  const { data, error } = await supabase.storage.from('jh-uploads').download(filePath);
  if (error || !data) return res.status(404).render('404', { title: 'File Not Found' });

  const buffer = Buffer.from(await data.arrayBuffer());
  const ext = order.format === 'audiobook' ? 'mp3' : 'pdf';
  const contentType = order.format === 'audiobook' ? 'audio/mpeg' : 'application/pdf';
  res.set('Content-Disposition', `attachment; filename="${order.jh_books.title}.${ext}"`);
  res.set('Content-Type', contentType);
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

// Stream audiobook (doesn't count as download)
router.get('/stream/:token', async (req, res) => {
  const { data: order } = await supabase.from('jh_orders').select('*, jh_books(*)').eq('download_token', req.params.token).eq('status', 'completed').single();
  if (!order || !order.jh_books?.audiobook_file) {
    return res.status(404).send('Not found');
  }
  const { data, error } = await supabase.storage.from('jh-uploads').download(order.jh_books.audiobook_file);
  if (error || !data) return res.status(404).send('File not found');
  const buffer = Buffer.from(await data.arrayBuffer());
  res.set('Content-Type', 'audio/mpeg');
  res.set('Content-Length', buffer.length);
  res.set('Accept-Ranges', 'bytes');
  res.send(buffer);
});

// Bundle checkout
router.post('/checkout-bundle', async (req, res) => {
  const { bundleId } = req.body;
  if (!STRIPE_KEY) {
    return res.status(400).json({ error: 'Stripe not configured yet' });
  }

  const stripe = require('stripe')(STRIPE_KEY);
  const { data: bundle } = await supabase.from('jh_bundles').select('*').eq('id', bundleId).eq('active', true).single();
  if (!bundle) return res.status(404).json({ error: 'Bundle not found' });

  const { data: items } = await supabase.from('jh_bundle_items').select('*, jh_books(title)').eq('bundle_id', bundleId);
  const itemNames = (items || []).map(i => `${i.jh_books?.title} (${i.format})`).join(', ');
  const hasPaperback = (items || []).some(i => i.format === 'paperback');

  const sessionConfig = {
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: bundle.title, description: itemNames },
        unit_amount: Math.round(parseFloat(bundle.price) * 100),
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${process.env.SITE_URL}/api/bundle-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_URL}/bundles`,
    metadata: { bundle_id: bundleId.toString() },
  };

  if (hasPaperback) {
    sessionConfig.shipping_address_collection = {
      allowed_countries: ['US', 'CA', 'GB', 'FR', 'DE', 'AU', 'NZ', 'IE', 'NL', 'BE', 'ES', 'IT', 'PT', 'AT', 'CH', 'SE', 'NO', 'DK', 'FI']
    };
  }

  const session = await stripe.checkout.sessions.create(sessionConfig);
  res.json({ url: session.url });
});

// Bundle success
router.get('/bundle-success', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.redirect('/?error=payment');

  try {
    const stripe = require('stripe')(STRIPE_KEY);
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status === 'paid') {
      const bundleId = parseInt(session.metadata.bundle_id);
      const { data: items } = await supabase.from('jh_bundle_items').select('*').eq('bundle_id', bundleId);

      // Create an order for each item in the bundle
      for (const item of (items || [])) {
        const downloadToken = crypto.randomBytes(32).toString('hex');
        const orderData = {
          book_id: item.book_id,
          bundle_id: bundleId,
          email: session.customer_details.email,
          stripe_session_id: session.id,
          stripe_payment_id: session.payment_intent,
          amount: session.amount_total / 100 / (items?.length || 1),
          status: 'completed',
          download_token: downloadToken,
          download_count: 0,
          format: item.format,
        };
        if (item.format === 'paperback' && session.shipping_details) {
          orderData.shipping_address = session.shipping_details;
        }
        const { data: order } = await supabase.from('jh_orders').insert(orderData).select().single();
        if (item.format === 'paperback' && order) {
          try { await createLuluPrintJob(order); } catch (e) { console.error('Lulu error:', e); }
        }
      }

      return res.redirect('/track?email=' + encodeURIComponent(session.customer_details.email));
    }
  } catch (err) {
    console.error('Bundle success error:', err);
  }
  res.redirect('/?error=payment');
});

module.exports = router;
