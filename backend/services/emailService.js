const nodemailer = require('nodemailer');
const https = require('https');

let transporter = null;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function extractEmailAddress(value) {
  const input = String(value || '').trim();
  if (!input) return '';

  const angleMatch = input.match(/<([^>]+)>/);
  if (angleMatch?.[1]) {
    return normalizeEmail(angleMatch[1]);
  }

  return normalizeEmail(input);
}

function getSenderIdentity() {
  const rawFrom = String(
    process.env.EMAIL_FROM || process.env.SMTP_USER || process.env.GMAIL_EMAIL || process.env.BREVO_SENDER_EMAIL || 'noreply@onegapo.gov.ph'
  ).trim();
  const senderEmail = extractEmailAddress(process.env.BREVO_SENDER_EMAIL || rawFrom) || 'noreply@onegapo.gov.ph';
  const senderName = String(process.env.BREVO_SENDER_NAME || 'OneGapo').trim() || 'OneGapo';

  return {
    fromHeader: rawFrom || senderEmail,
    senderEmail,
    senderName,
  };
}

function postJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url);
    const body = JSON.stringify(payload);

    const req = https.request(
      {
        protocol: requestUrl.protocol,
        hostname: requestUrl.hostname,
        port: requestUrl.port || 443,
        path: `${requestUrl.pathname}${requestUrl.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          const status = Number(res.statusCode || 0);
          if (status >= 200 && status < 300) {
            resolve({ status, body: responseBody });
            return;
          }
          reject(new Error(`HTTP ${status}: ${responseBody || 'Unknown error'}`));
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function shouldTryApiFallback(err) {
  const code = String(err?.code || '').toUpperCase();
  return code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ESOCKET' || code === 'ENOTFOUND';
}

function getBrevoApiKey() {
  return String(process.env.BREVO_API_KEY || '').trim();
}

async function sendViaBrevoApi({ to, subject, html, text, senderEmail, senderName }) {
  const apiKey = getBrevoApiKey();
  if (!apiKey) {
    const err = new Error('BREVO_API_KEY is not configured.');
    err.code = 'BREVO_API_KEY_MISSING';
    throw err;
  }

  const recipient = normalizeEmail(to);
  if (!recipient) {
    const err = new Error('Recipient email is required.');
    err.code = 'EMAIL_RECIPIENT_MISSING';
    throw err;
  }

  const fromEmail = extractEmailAddress(senderEmail) || 'noreply@onegapo.gov.ph';
  const fromName = String(senderName || process.env.BREVO_SENDER_NAME || 'OneGapo').trim() || 'OneGapo';

  const payload = {
    sender: {
      name: fromName,
      email: fromEmail,
    },
    to: [{ email: recipient }],
    subject,
    htmlContent: html,
    textContent: text,
  };

  const result = await postJson('https://api.brevo.com/v3/smtp/email', payload, {
    'api-key': apiKey,
  });

  let parsedBody = null;
  try {
    parsedBody = result.body ? JSON.parse(result.body) : null;
  } catch {
    parsedBody = null;
  }

  return {
    provider: 'brevo-api',
    accepted: [recipient],
    status: result.status,
    messageId: parsedBody?.messageId || 'brevo-api',
  };
}

/**
 * Initialize the email transporter based on environment configuration
 * Returns null if not configured, throws only for hard errors
 */
function initializeTransporter() {
  if (transporter) return transporter;

  const emailProvider = process.env.EMAIL_PROVIDER || 'gmail';
  
  try {
    if (emailProvider === 'gmail') {
      if (!process.env.GMAIL_EMAIL || process.env.GMAIL_EMAIL.includes('your-gmail')) {
        console.warn('[EmailService] Gmail not configured. Set GMAIL_EMAIL and GMAIL_APP_PASSWORD in .env');
        return null;
      }
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_EMAIL,
          pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, ''), // Remove spaces from app password
        },
      });
      
      // Test connection asynchronously to catch auth errors
      transporter.verify((error) => {
        if (error) {
          console.error('[EmailService] Gmail authentication failed:', error.message);
          console.error('  - Check GMAIL_EMAIL and GMAIL_APP_PASSWORD in .env');
          console.error('  - Ensure you\'re using an App Password (not regular password)');
          console.error('  - See: https://myaccount.google.com/apppasswords');
          transporter = null;
        } else {
          console.log('[EmailService] Gmail transporter verified successfully');
        }
      });
    } else if (emailProvider === 'smtp') {
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.warn('[EmailService] SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env');
        return null;
      }
      const smtpHost = String(process.env.SMTP_HOST || '').trim();
      const smtpUser = String(process.env.SMTP_USER || '').trim();
      const smtpPass = String(process.env.SMTP_PASS || '').trim();
      transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT, 10) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        connectionTimeout: parseInt(process.env.SMTP_CONNECTION_TIMEOUT_MS, 10) || 15000,
        greetingTimeout: parseInt(process.env.SMTP_GREETING_TIMEOUT_MS, 10) || 10000,
        socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT_MS, 10) || 20000,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
    } else {
      console.warn(`[EmailService] Unknown EMAIL_PROVIDER: ${emailProvider}. Defaulting to disabled.`);
      return null;
    }
    return transporter;
  } catch (err) {
    console.error('[EmailService] Failed to initialize transporter:', err.message);
    return null;
  }
}

/**
 * Send an application-managed email verification link.
 *
 * @param {string} email - The recipient's email address
 * @param {string} verificationLink - The OneGapo verification link
 * @param {{ branchName?: string | null }} options - Email personalization options
 */
async function sendVerificationEmail(email, verificationLink, options = {}) {
  try {
    const recipient = normalizeEmail(email);
    if (!recipient) {
      console.warn('[EmailService] Verification email skipped: recipient email is missing.');
      return { skipped: true, reason: 'Recipient email is missing' };
    }

    const senderIdentity = getSenderIdentity();
    const trans = initializeTransporter();
    if (!trans) {
      if (getBrevoApiKey()) {
        const apiResult = await sendViaBrevoApi({
          to: recipient,
          subject: 'Verify Your OneGapo Email Address',
          html: `Welcome to OneGapo! Verify your email here: ${verificationLink}`,
          text: `Welcome to OneGapo! Click here to verify your email: ${verificationLink}`,
          senderEmail: senderIdentity.senderEmail,
          senderName: senderIdentity.senderName,
        });
        console.log(`[EmailService] Verification email sent via Brevo API to ${recipient}`, apiResult.messageId);
        return apiResult;
      }

      console.warn('[EmailService] Email not configured. Verification link not sent:', recipient);
      return { skipped: true, reason: 'Email not configured' };
    }

    const branchName = options.branchName || null;
    const locationText = branchName ? ` for your account at ${branchName}` : ' for your account';
    const htmlContent = `
      <html>
        <body style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #1e40af; margin: 0;">OneGapo</h1>
              <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">City Management System</p>
            </div>
            
            <h2 style="color: #333; margin-bottom: 20px;">Verify Your Email</h2>
            
            <p style="color: #555; font-size: 16px; line-height: 1.5;">
              Welcome to OneGapo. Please verify the email address connected to${locationText}.
            </p>
            
            <p style="color: #555; font-size: 16px; line-height: 1.5;">
              Please verify your email address by clicking the button below:
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationLink}" style="background-color: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
                Verify Email Address
              </a>
            </div>
            
            <p style="color: #777; font-size: 14px; line-height: 1.5;">
              Or copy and paste this link in your browser:<br/>
              <span style="word-break: break-all; color: #0066cc;">${verificationLink}</span>
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            
            <p style="color: #888; font-size: 12px; text-align: center; margin: 0;">
              © ${new Date().getFullYear()} OneGapo City Management System. All rights reserved.
            </p>
          </div>
        </body>
      </html>
    `;

    const messagePayload = {
      from: senderIdentity.fromHeader,
      to: recipient,
      subject: 'Verify Your OneGapo Email Address',
      html: htmlContent,
      text: `Welcome to OneGapo! Click here to verify your email: ${verificationLink}`,
    };

    let result;
    try {
      result = await trans.sendMail(messagePayload);
    } catch (smtpErr) {
      if (shouldTryApiFallback(smtpErr) && getBrevoApiKey()) {
        console.warn('[EmailService] SMTP send failed, attempting Brevo API fallback:', smtpErr.message);
        result = await sendViaBrevoApi({
          to: recipient,
          subject: messagePayload.subject,
          html: messagePayload.html,
          text: messagePayload.text,
          senderEmail: senderIdentity.senderEmail,
          senderName: senderIdentity.senderName,
        });
      } else {
        throw smtpErr;
      }
    }

    console.log(`[EmailService] Verification email sent to ${recipient}`, result.messageId);
    return result;
  } catch (err) {
    console.error('[EmailService] Failed to send verification email to', email);
    console.error('  Error:', err.message);
    if (err.response) console.error('  Response:', err.response);
    if (err.code) console.error('  Code:', err.code);
    throw err;
  }
}

/**
 * Send password reset link to a newly created staff member
 *
 * @param {string} email - The staff member's email address
 * @param {string} resetLink - The Firebase password reset link
 * @param {string} branchName - The branch/location name they're assigned to
 */
async function sendPasswordResetEmail(email, resetLink, branchName = null) {
  try {
    const recipient = normalizeEmail(email);
    if (!recipient) {
      console.warn('[EmailService] Password reset email skipped: recipient email is missing.');
      return { skipped: true, reason: 'Recipient email is missing' };
    }

    const senderIdentity = getSenderIdentity();
    const trans = initializeTransporter();
    if (!trans) {
      if (getBrevoApiKey()) {
        const apiResult = await sendViaBrevoApi({
          to: recipient,
          subject: '[OneGapo] Set Your Staff Account Password',
          html: `Set your password here: ${resetLink}`,
          text: `Set your password here: ${resetLink}. This link expires after 24 hours.`,
          senderEmail: senderIdentity.senderEmail,
          senderName: senderIdentity.senderName,
        });
        console.log(`[EmailService] Password reset email sent via Brevo API to ${recipient}`, apiResult.messageId);
        return apiResult;
      }

      console.warn('[EmailService] Email not configured. Password reset link not sent:', recipient);
      return { skipped: true, reason: 'Email not configured' };
    }

    const locationText = branchName ? ` at ${branchName}` : '';
    const htmlContent = `
      <html>
        <body style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #1e40af; margin: 0;">OneGapo</h1>
              <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">City Management System</p>
            </div>
            
            <h2 style="color: #333; margin-bottom: 20px;">Set Your Password</h2>
            
            <p style="color: #555; font-size: 16px; line-height: 1.5;">
              Your staff account has been created${locationText}.
            </p>
            
            <p style="color: #555; font-size: 16px; line-height: 1.5;">
              Click the button below to set your password:
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" style="background-color: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
                Set Your Password
              </a>
            </div>
            
            <p style="color: #777; font-size: 14px; line-height: 1.5;">
              Or copy and paste this link in your browser:<br/>
              <span style="word-break: break-all; color: #0066cc;">${resetLink}</span>
            </p>
            
            <p style="color: #d97706; font-size: 14px; font-weight: bold; margin-top: 20px;">
              Note: This link expires after 24 hours.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            
            <p style="color: #888; font-size: 12px; text-align: center; margin: 0;">
              © ${new Date().getFullYear()} OneGapo City Management System. All rights reserved.
            </p>
          </div>
        </body>
      </html>
    `;

    const messagePayload = {
      from: senderIdentity.fromHeader,
      to: recipient,
      subject: '[OneGapo] Set Your Staff Account Password',
      html: htmlContent,
      text: `Set your password here: ${resetLink}. This link expires after 24 hours.`,
    };

    let result;
    try {
      result = await trans.sendMail(messagePayload);
    } catch (smtpErr) {
      if (shouldTryApiFallback(smtpErr) && getBrevoApiKey()) {
        console.warn('[EmailService] SMTP send failed, attempting Brevo API fallback:', smtpErr.message);
        result = await sendViaBrevoApi({
          to: recipient,
          subject: messagePayload.subject,
          html: messagePayload.html,
          text: messagePayload.text,
          senderEmail: senderIdentity.senderEmail,
          senderName: senderIdentity.senderName,
        });
      } else {
        throw smtpErr;
      }
    }

    console.log(`[EmailService] Password reset email sent to ${recipient}`, result.messageId);
    return result;
  } catch (err) {
    console.error('[EmailService] Failed to send password reset email to', email);
    console.error('  Error:', err.message);
    if (err.response) console.error('  Response:', err.response);
    if (err.code) console.error('  Code:', err.code);
    throw err;
  }
}

function summarizeEmailDeliveries(resultsByType) {
  const summary = {};

  for (const [emailType, result] of Object.entries(resultsByType)) {
    if (result.status === 'fulfilled') {
      if (result.value && result.value.skipped) {
        summary[emailType] = {
          sent: false,
          skipped: true,
          reason: result.value.reason || 'Email not configured',
        };
      } else {
        summary[emailType] = {
          sent: true,
          skipped: false,
        };
      }
      continue;
    }

    summary[emailType] = {
      sent: false,
      skipped: false,
      error: result.reason?.message || 'Unknown email error',
    };
  }

  const allSent = Object.values(summary).every((entry) => entry.sent);

  return {
    allSent,
    summary,
  };
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, summarizeEmailDeliveries };
