const fs = require("fs");
const path = require("path");
const { v2: cloudinary } = require("cloudinary");
const { config } = require("./config");
const { randomSlug, sanitizeFilename } = require("./security");

const CLOUDINARY_PROVIDER = "cloudinary";
const LOCAL_PROVIDER = "local";

function isCloudinaryEnabled() {
  return config.storageDriver === CLOUDINARY_PROVIDER;
}

function normalizeCloudinaryUrl(value) {
  if (!value) return "";
  return value.replace(/^CLOUDINARY_URL=/, "").trim();
}

function parseCloudinaryUrl(value) {
  const normalized = normalizeCloudinaryUrl(value);
  if (!normalized) return null;
  const match = normalized.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
  if (!match) return null;
  return {
    api_key: decodeURIComponent(match[1]),
    api_secret: decodeURIComponent(match[2]),
    cloud_name: decodeURIComponent(match[3])
  };
}

function cloudinaryCredentials() {
  const fromUrl = parseCloudinaryUrl(process.env.CLOUDINARY_URL);
  if (fromUrl) return fromUrl;
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    return {
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    };
  }
  return null;
}

if (isCloudinaryEnabled()) {
  const credentials = cloudinaryCredentials();
  if (credentials) {
    cloudinary.config({ ...credentials, secure: true });
  }
}

function localPostDir(postId) {
  return path.join(config.uploadDir, String(postId));
}

async function storeUploadedFile(file, postId) {
  const safeOriginal = sanitizeFilename(file.originalname);
  const safeStored = sanitizeFilename(file.filename);

  if (!isCloudinaryEnabled()) {
    const postDir = localPostDir(postId);
    fs.mkdirSync(postDir, { recursive: true });
    fs.renameSync(file.path, path.join(postDir, safeStored));
    return {
      originalName: safeOriginal,
      storedName: safeStored,
      provider: LOCAL_PROVIDER,
      storageKey: safeStored,
      resourceType: "raw",
      deliveryType: "local",
      format: path.extname(safeOriginal).replace(".", "") || null
    };
  }

  if (!cloudinaryCredentials()) {
    throw new Error("Cloudinary is not configured. Set CLOUDINARY_URL in Render without extra spaces or question marks.");
  }

  const publicId = `${config.cloudinaryFolder}/posts/${postId}/${randomSlug()}`;
  const result = await cloudinary.uploader.upload(file.path, {
    public_id: publicId,
    resource_type: "auto",
    type: "authenticated",
    use_filename: false,
    unique_filename: false,
    overwrite: false
  });
  fs.rmSync(file.path, { force: true });

  return {
    originalName: safeOriginal,
    storedName: result.public_id,
    provider: CLOUDINARY_PROVIDER,
    storageKey: result.public_id,
    resourceType: result.resource_type || "raw",
    deliveryType: result.type || "authenticated",
    format: result.format || null
  };
}

function localFilePath(postId, file) {
  return path.join(localPostDir(postId), file.stored_name);
}

function signedCloudinaryUrl(file, options = {}) {
  return cloudinary.url(file.storage_key || file.stored_name, {
    resource_type: file.storage_resource_type || "raw",
    type: file.storage_delivery_type || "authenticated",
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + 10 * 60,
    format: file.storage_format || undefined,
    attachment: options.attachment ? file.original_name : undefined,
    transformation: options.preview
      ? [{ width: 640, height: 420, crop: "limit", quality: "auto", fetch_format: "auto" }]
      : undefined
  });
}

function sendStoredFile(res, postId, file, options = {}) {
  if (file.storage_provider === CLOUDINARY_PROVIDER) {
    return res.redirect(signedCloudinaryUrl(file, options));
  }

  const filePath = localFilePath(postId, file);
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (options.preview) {
    res.setHeader("Content-Type", file.mime_type || "application/octet-stream");
    return res.sendFile(filePath);
  }
  res.setHeader("Content-Type", "application/octet-stream");
  return res.download(filePath, file.original_name);
}

async function deleteStoredFile(file) {
  if (file.storage_provider === CLOUDINARY_PROVIDER) {
    await cloudinary.uploader.destroy(file.storage_key || file.stored_name, {
      resource_type: file.storage_resource_type || "raw",
      type: file.storage_delivery_type || "authenticated",
      invalidate: true
    });
  }
}

function removeLocalPostDir(postId) {
  fs.rmSync(localPostDir(postId), { recursive: true, force: true });
}

module.exports = {
  isCloudinaryEnabled,
  storeUploadedFile,
  sendStoredFile,
  deleteStoredFile,
  removeLocalPostDir
};
