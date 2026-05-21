require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { initSocketServer } = require('./realtime/socketServer');

// ─── Startup environment validation ────────────────────────────────────────
(function validateEnv() {
  const warnings = [];

  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    warnings.push('  ❌ FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH is required');
  }

  if (!process.env.SMTP_HOST && !process.env.BREVO_API_KEY) {
    warnings.push('  ⚠️  No email transport configured. Set SMTP_HOST+SMTP_USER+SMTP_PASS or BREVO_API_KEY');
  }

  if (process.env.SMTP_HOST && !process.env.BREVO_API_KEY) {
    warnings.push('  ⚠️  BREVO_API_KEY is not set — SMTP fallback will not work if port 587 is blocked');
  }

  if (!process.env.FRONTEND_URL) {
    warnings.push('  ⚠️  FRONTEND_URL is not set — verification links will use http://localhost:5173 fallback');
  } else if (process.env.FRONTEND_URL.includes('localhost') && process.env.NODE_ENV === 'production') {
    warnings.push('  ⚠️  FRONTEND_URL points to localhost but NODE_ENV=production — update for deployment');
  }

  if (warnings.length > 0) {
    console.warn('\n[OneGapo] ⚠️  Configuration warnings:');
    warnings.forEach((w) => console.warn(w));
    console.warn('');
  } else {
    console.log('[OneGapo] ✅ Environment validated OK');
  }
})();


const adminRoutes  = require('./routes/adminRoutes');
const authRoutes   = require('./routes/authRoutes');
const branchRoutes = require('./routes/branchRoutes');
const rolesRoutes  = require('./routes/rolesRoutes');
const reportRoutes = require('./routes/reportRoutes');

const app = express();
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

function parseAllowedOrigins(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function createOriginMatcher() {
  const configured = parseAllowedOrigins(process.env.FRONTEND_URL);

  const defaults = [
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/,
    /^http:\/\/[\[]::1[\]](:\d+)?$/,
    /^https:\/\/.*\.vercel\.app$/,
  ];

  const allowlist = [...defaults, ...configured];

  return (origin, callback) => {
    // Allow non-browser and same-origin requests that may not send Origin.
    if (!origin) {
      callback(null, true);
      return;
    }

    const isAllowed = allowlist.some((entry) => {
      if (entry instanceof RegExp) {
        return entry.test(origin);
      }

      if (String(entry).toLowerCase() === 'vercel-preview') {
        return /^https:\/\/.*\.vercel\.app$/.test(origin);
      }

      return String(entry) === origin;
    });

    if (isAllowed) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  };
}

const allowedOrigin = createOriginMatcher();

app.use(
  cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/admin/branches', branchRoutes);
app.use('/api/admin/roles',    rolesRoutes);
app.use('/api/admin',          adminRoutes);
app.use('/api/auth',           authRoutes);
app.use('/api/reports',        reportRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Resource not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[Error]', err.message || err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'An unexpected server error occurred.',
  });
});

initSocketServer(server, { allowedOrigin });

server.listen(PORT, () => {
  console.log(`OneGapo backend listening on http://localhost:${PORT}`);
});
