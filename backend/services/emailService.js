const nodemailer = require('nodemailer');

let transporter = null;

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
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
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
    const trans = initializeTransporter();
    if (!trans) {
      console.warn('[EmailService] Email not configured. Verification link not sent:', email);
      return { skipped: true, reason: 'Email not configured' };
    }

    const sender = process.env.EMAIL_FROM || process.env.SMTP_USER || process.env.GMAIL_EMAIL || 'noreply@onegapo.gov.ph';

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

    const result = await trans.sendMail({
      from: sender,
      to: email,
      subject: 'Verify Your OneGapo Email Address',
      html: htmlContent,
      text: `Welcome to OneGapo! Click here to verify your email: ${verificationLink}`,
    });

    console.log(`[EmailService] Verification email sent to ${email}`, result.messageId);
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
    const trans = initializeTransporter();
    if (!trans) {
      console.warn('[EmailService] Email not configured. Password reset link not sent:', email);
      return { skipped: true, reason: 'Email not configured' };
    }

    const sender = process.env.EMAIL_FROM || process.env.SMTP_USER || process.env.GMAIL_EMAIL || 'noreply@onegapo.gov.ph';

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

    const result = await trans.sendMail({
      from: sender,
      to: email,
      subject: '[OneGapo] Set Your Staff Account Password',
      html: htmlContent,
      text: `Set your password here: ${resetLink}. This link expires after 24 hours.`,
    });

    console.log(`[EmailService] Password reset email sent to ${email}`, result.messageId);
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
