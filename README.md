# Jude Harper - Book Store

A Gumroad-style digital book store built with Node.js + Express for Hostinger deployment.

## Tech Stack
- **Runtime**: Node.js + Express
- **Views**: EJS + Tailwind CSS (CDN)
- **Database**: SQLite (better-sqlite3)
- **Payments**: Stripe Checkout
- **Hosting**: Hostinger Node.js

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your values
npm run dev
```

Visit `http://localhost:3000`

## Admin Panel

Go to `/admin/login` and use the password from `.env` (`ADMIN_PASSWORD`).

## Hostinger Deployment

1. In Hostinger hPanel, go to **Node.js** section
2. Set startup file to `server.js`
3. Upload files via Git or File Manager
4. Set environment variables in hPanel
5. Restart the Node.js application

## Features
- Book catalog with cover images
- Stripe Checkout for payments
- Digital file delivery with download tokens
- Admin panel (books, orders, subscribers)
- Newsletter signup
- Mobile-responsive design
