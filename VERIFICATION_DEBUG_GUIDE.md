# Email Verification Debugging Guide

## Overview
The email verification system has been enhanced with comprehensive logging to help diagnose why accounts aren't getting marked as verified.

## What Changed
1. **Enhanced Logging**: Every step of the verification process now logs detailed information
2. **Diagnostic Endpoint**: New endpoint to check if verification tokens are being created and stored

## How to Debug

### Step 1: Check Server Logs
When you run the backend, it will now log detailed information:

```bash
cd backend
npm start
# OR if using custom start script
node index.js
```

Watch the console for messages like:
- `[createVerificationToken] Creating token for uid: ...` - Token creation started
- `[createVerificationToken] Token successfully saved to Firestore for uid: ...` - Token saved
- `[verifyEmailToken] Looking for token with hash: ...` - Searching for token
- `[verifyEmailToken] Query returned X document(s)` - Token found (should be 1)
- `[markUserVerified] Marking user ... as verified` - Starting verification
- `[markUserVerified] Setting Auth claims...` - Updating Firebase Auth
- `[markUserVerified] Partial failure for uid ...` - Error occurred (this is what we want to see)

### Step 2: Use the Diagnostic Endpoint
After getting a verification email link, extract the token from the URL and test it:

The link in the email will look like:
```
http://localhost:5173/verify-email?token=abc123def456...
```

Test if the token exists:
```bash
# Replace TOKEN_HERE with the actual token from the URL
curl "http://localhost:5000/api/diagnostic/check-token?token=TOKEN_HERE"
```

Expected response if token exists:
```json
{
  "success": true,
  "data": {
    "found": true,
    "uid": "user123",
    "email": "user@example.com",
    "createdAt": "2025-01-20T10:30:00Z",
    "expiresAt": "2025-01-21T10:30:00Z",
    "isExpired": false,
    "isUsed": false
  },
  "message": "Token found"
}
```

If token is NOT found:
```json
{
  "success": true,
  "data": {
    "found": false,
    "message": "Token not found in database"
  }
}
```

### Step 3: Troubleshoot Based on Results

#### **Case A: Token Not Found**
- The token is NOT being saved to Firestore during registration
- Check server logs for: `[createVerificationToken] Failed to save token to Firestore`
- **Likely causes:**
  - Firestore security rules blocking writes to `emailVerificationTokens` collection
  - Firestore quota exceeded
  - Firebase Admin SDK not initialized properly
  - Firestore database is offline

#### **Case B: Token Found But Not Used**
- The token exists but verification doesn't mark it as used
- Click the verification link and watch for: `[verifyEmailToken] Looking for token with hash...`
- **Check for:**
  - `[markUserVerified] Partial failure` - Which operation failed? (Auth claims / Firestore user / Firestore token)
  - Network errors
  - Permission issues

#### **Case C: Token Found and Marked Used but User Not Verified**
- The token exists and was used, but the user's `verified` field isn't `true`
- Check if Firestore write succeeded: Look for `[markUserVerified] Successfully marked user ... as verified`
- Check the Firestore Console: Navigate to `users` collection and look at your test user document
- **Likely causes:**
  - Firestore security rules blocking writes to `users` collection
  - User document doesn't exist in Firestore

### Step 4: Check Firestore Directly

Go to Firebase Console → Firestore Database:

1. **Check emailVerificationTokens collection:**
   - Should have a document for each user with a pending verification
   - Document ID should be the user's UID
   - Fields: `tokenHash`, `createdAt`, `expiresAt`, `usedAt` (null until used)

2. **Check users collection:**
   - Find your test user's document
   - Verify the `verified` field (should be `true` after successful verification)
   - Check `verifiedAt` field (should have a timestamp)

### Step 5: Test the Full Flow

**With enhanced logging:**

```bash
# Terminal 1: Start backend with logs visible
cd backend
npm start

# Terminal 2: Register a new account
curl -X POST http://localhost:5000/api/auth/complete-registration \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Test User","contactNumber":"+1234567890","address":"123 Main St"}'

# Watch Terminal 1 for token creation logs
```

## Key Log Messages to Look For

| Message | Means |
|---------|-------|
| `Token successfully saved to Firestore` | ✅ Token creation working |
| `Failed to save token to Firestore` | ❌ Can't write to Firestore |
| `Query returned 1 document(s)` | ✅ Token found during verification |
| `Query returned 0 document(s)` | ❌ Token not found or corrupted in transit |
| `Token already used` | ℹ️ Verification already done |
| `Partial failure` | ❌ One of the verification steps failed |

## If You Still Have Issues

1. Check the backend console output for the exact error message
2. Verify Firestore collections exist:
   - `emailVerificationTokens`
   - `users`
3. Check Firebase Console → Database → Rules (are they too restrictive?)
4. Ensure Firebase Admin SDK credentials are valid (check firebaseAdmin.js)

---

**Last Updated:** January 20, 2025
