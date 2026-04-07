require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDb } = require('./db/setup');

// Initialize database
initDb();

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Make session data available to all views
app.use((req, res, next) => {
  res.locals.isAdmin = req.session.isAdmin || false;
  res.locals.stripeKey = process.env.STRIPE_PUBLISHABLE_KEY;
  next();
});

// Routes
app.use('/', require('./routes/store'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));

// 404
app.use((req, res) => {
  res.status(404).render('404', { title: 'Page Not Found' });
});

// Start server (skip in Vercel serverless)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Jude Harper Store running at http://localhost:${PORT}`);
  });
}

module.exports = app;
