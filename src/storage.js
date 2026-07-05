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

if (isCloudinaryEnabled()) {
  const cloudinaryConfig = { secure: true };
  if (process.env.CLOUDINARY_CLOUD_NAME) cloudinaryConfig.cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  if (process.env.CLOUDINARY_API_KEY) cloudinaryConfig.api_key = process.env.CLOUDINARY_API_KEY;
  if (process.env.CLOUDINARY_API_SECRET) cloudinaryConfig.api_secret = process.env.CLOUDINARY_API_SECRET;
  cloudinary.config(cloudinaryConfig);
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
