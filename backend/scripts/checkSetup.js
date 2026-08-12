/**
 * OneGapo — Email Verification Setup Checker
 *
 * Usage:
 *   cd backend
 *   node scripts/checkSetup.js
 *   node scripts/checkSetup.js --send-test-email=you@example.com
 *
 * Checks:
 *   1. Required environment variables
 *   2. Firebase Admin SDK initialisation
 *   3. Firestore read/write access
 *   4. Email transport (SMTP or Brevo API)
 *   5. (Optional) Sends a real test verification email
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const BOLD   = '\x1b[1m';

const ok   = (msg) => console.log(`${GREEN}  ✅ ${msg}${RESET}`);
const warn = (msg) => console.log(`${YELLOW}  ⚠️  ${msg}${RESET}`);
const fail = (msg) => console.log(`${RED}  ❌ ${msg}${RESET}`);
const info = (msg) => console.log(`     ${msg}`);

let hasErrors = false;

function checkEnv() {
  console.log(`\n${BOLD}── 1. Environment Variables ───────────────────────────────${RESET}`);

  const required = [
    ['FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH',
      !!(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_PATH)],
    ['FRONTEND_URL', !!process.env.FRONTEND_URL],
    ['EMAIL_PROVIDER', !!process.env.EMAIL_PROVIDER],
  ];

  for (const [name, present] of required) {
    if (present) {
      ok(name);
    } else {
      fail(`${name} — MISSING`);
      hasErrors = true;
    }
  }

  // Email-specific checks
  const provider = process.env.EMAIL_PROVIDER;
  if (provider === 'smtp') {
    const smtpOk = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
    smtpOk ? ok('SMTP_HOST / SMTP_USER / SMTP_PASS') : (fail('SMTP_HOST / SMTP_USER / SMTP_PASS — one or more missing'), hasErrors = true);

    if (process.env.BREVO_API_KEY) {
      ok('BREVO_API_KEY (optional fallback transport)');
    } else {
      info('BREVO_API_KEY not set — optional fallback only; SMTP remains active without it');
    }
  } else if (provider === 'gmail') {
    const gmailOk = process.env.GMAIL_EMAIL && process.env.GMAIL_APP_PASSWORD;
    gmailOk ? ok('GMAIL_EMAIL / GMAIL_APP_PASSWORD') : (fail('GMAIL_EMAIL / GMAIL_APP_PASSWORD — one or more missing'), hasErrors = true);
  }

  const frontendUrl = process.env.FRONTEND_URL || '';
  if (frontendUrl.includes('localhost')) {
    warn(`FRONTEND_URL is set to localhost — emails will contain local links`);
    info(`  Current: ${frontendUrl}`);
    info(`  For production set: FRONTEND_URL=https://onegapo.vercel.app`);
  } else {
    ok(`FRONTEND_URL → ${frontendUrl}`);
  }

  const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.EMAIL_FROM || '(not set)';
  ok(`Sender identity: ${senderEmail}`);
  if (senderEmail === '(not set)') {
    warn('Set BREVO_SENDER_EMAIL in .env (must be verified in Brevo → Senders & IP)');
  }
}

async function checkFirebase() {
  console.log(`\n${BOLD}── 2. Firebase Admin SDK ──────────────────────────────────${RESET}`);
  try {
    const admin = require('../config/firebaseAdmin');
    ok('Firebase Admin SDK initialised');

    console.log(`\n${BOLD}── 3. Firestore Access ────────────────────────────────────${RESET}`);
    try {
      const db = admin.firestore();
      const testRef = db.collection('_setup_check').doc('ping');
      await testRef.set({ ts: admin.firestore.FieldValue.serverTimestamp() });
      await testRef.delete();
      ok('Firestore read/write access confirmed');
    } catch (err) {
      fail(`Firestore access failed: ${err.message}`);
      info('  Check Firestore security rules allow Admin SDK writes');
      hasErrors = true;
    }

    return admin;
  } catch (err) {
    fail(`Firebase Admin init failed: ${err.message}`);
    info('  Verify FIREBASE_SERVICE_ACCOUNT_PATH points to a valid serviceAccountKey.json');
    hasErrors = true;
    return null;
  }
}

async function checkEmail(testEmailAddress) {
  console.log(`\n${BOLD}── 4. Email Transport ─────────────────────────────────────${RESET}`);
  try {
    const { sendVerificationEmail } = require('../services/emailService');

    if (!testEmailAddress) {
      warn('Skipping live email test (no --send-test-email address provided)');
      info('  Run with: node scripts/checkSetup.js --send-test-email=you@example.com');
      return;
    }

    console.log(`     Sending test email to ${testEmailAddress}…`);
    const result = await sendVerificationEmail(
      testEmailAddress,
      `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verify-email?token=TEST_TOKEN_DO_NOT_CLICK`,
      { branchName: 'Setup Check' }
    );

    if (result?.skipped) {
      warn(`Email skipped: ${result.reason}`);
      hasErrors = true;
    } else {
      ok(`Test email sent via ${result?.provider || 'configured transport'}`);
      info(`  Message ID: ${result?.messageId || 'N/A'}`);
    }
  } catch (err) {
    fail(`Email send failed: ${err.message}`);
    if (err.code) info(`  Error code: ${err.code}`);
    if (err.response) info(`  SMTP response: ${err.response}`);
    hasErrors = true;
  }
}

async function checkServiceAccountFile() {
  console.log(`\n${BOLD}── 0. Service Account File ────────────────────────────────${RESET}`);
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!saPath) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      ok('Using FIREBASE_SERVICE_ACCOUNT_JSON (inline JSON)');
    } else {
      fail('Neither FIREBASE_SERVICE_ACCOUNT_PATH nor FIREBASE_SERVICE_ACCOUNT_JSON is set');
      hasErrors = true;
    }
    return;
  }

  const path = require('path');
  const fs = require('fs');
  const resolvedPath = path.resolve(__dirname, '..', saPath);
  if (fs.existsSync(resolvedPath)) {
    ok(`serviceAccountKey.json found at ${resolvedPath}`);
  } else {
    fail(`serviceAccountKey.json NOT found at ${resolvedPath}`);
    info('  Download it from Firebase Console → Project Settings → Service Accounts');
    hasErrors = true;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const testEmailArg = args.find((a) => a.startsWith('--send-test-email='));
  const testEmail = testEmailArg ? testEmailArg.split('=')[1] : null;

  console.log(`\n${BOLD}OneGapo — Email Verification Setup Check${RESET}`);
  console.log('══════════════════════════════════════════');

  await checkServiceAccountFile();
  checkEnv();
  const admin = await checkFirebase();

  if (admin) {
    await checkEmail(testEmail);
  } else {
    console.log(`\n${BOLD}── 4. Email Transport ─────────────────────────────────────${RESET}`);
    warn('Skipping email check — Firebase Admin failed to initialise');
  }

  console.log('\n══════════════════════════════════════════');
  if (hasErrors) {
    console.log(`${RED}${BOLD}Result: Issues found. Fix the ❌ items above before running the server.${RESET}\n`);
    process.exit(1);
  } else {
    console.log(`${GREEN}${BOLD}Result: All checks passed ✅${RESET}\n`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`\n${RED}Unexpected error during setup check:${RESET}`, err.message);
  process.exit(1);
});
