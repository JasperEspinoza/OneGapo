require('dotenv').config();
const express = require('express');
const cors = require('cors');

const adminRoutes  = require('./routes/adminRoutes');
const authRoutes   = require('./routes/authRoutes');
const branchRoutes = require('./routes/branchRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// CORS: in development accept any localhost port; in production use FRONTEND_URL
const allowedOrigin = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL
  : /^http:\/\/localhost(:\d+)?$/;

app.use(
  cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Parse incoming JSON bodies
app.use(express.json());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// /api/admin/branches must be registered before /api/admin so Express
// routes the more-specific path first.
app.use('/api/admin/branches', branchRoutes);
app.use('/api/admin',          adminRoutes);
app.use('/api/auth',           authRoutes);

// ---------------------------------------------------------------------------
// 404 handler — must be after all routes
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'Resource not found.' });
});

// ---------------------------------------------------------------------------
// Global error handler — must have exactly 4 parameters so Express recognises it
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[Error]', err.message || err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'An unexpected server error occurred.',
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`OneGapo backend listening on http://localhost:${PORT}`);
});
