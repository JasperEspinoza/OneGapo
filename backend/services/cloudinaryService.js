const { v2: cloudinary } = require('cloudinary');

function getCloudinaryConfig() {
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
    folder: process.env.CLOUDINARY_UPLOAD_FOLDER || 'onegapo/reports',
  };
}

function isCloudinaryConfigured() {
  const cfg = getCloudinaryConfig();
  return Boolean(cfg.cloudName && cfg.apiKey && cfg.apiSecret);
}

function ensureCloudinaryConfigured() {
  if (!isCloudinaryConfigured()) {
    const err = new Error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
    err.status = 503;
    throw err;
  }

  const cfg = getCloudinaryConfig();
  cloudinary.config({
    cloud_name: cfg.cloudName,
    api_key: cfg.apiKey,
    api_secret: cfg.apiSecret,
  });

  return cfg;
}

function uploadBufferToCloudinary(fileBuffer, options = {}) {
  const cfg = ensureCloudinaryConfigured();

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'auto',
        folder: options.folder || cfg.folder,
        use_filename: false,
        unique_filename: true,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      }
    );

    uploadStream.end(fileBuffer);
  });
}

async function deleteResourceByPublicId(publicId, options = {}) {
  const cfg = ensureCloudinaryConfigured();

  return new Promise((resolve, reject) => {
    // resource_type defaults to 'image' but allow override (video/auto)
    const params = { resource_type: options.resource_type || 'image' };
    cloudinary.uploader.destroy(publicId, params, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
  });
}

module.exports = {
  isCloudinaryConfigured,
  uploadBufferToCloudinary,
  deleteResourceByPublicId,
};
