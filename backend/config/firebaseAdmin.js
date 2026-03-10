const admin = require('firebase-admin');
const path = require('path');

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      throw new Error(
        'Firebase Admin: FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON. ' +
        'Ensure the value is a properly formatted single-line JSON string.'
      );
    }
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const resolvedPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    try {
      return require(resolvedPath);
    } catch {
      throw new Error(
        `Firebase Admin: Could not load service account file at "${resolvedPath}". ` +
        'Verify the path in FIREBASE_SERVICE_ACCOUNT_PATH and that the file exists.'
      );
    }
  }

  throw new Error(
    'Firebase Admin: No credentials configured. ' +
    'Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH in your .env file.'
  );
}

if (!admin.apps.length) {
  const serviceAccount = loadServiceAccount();
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

module.exports = admin;
