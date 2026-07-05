const path = require("path");
require("dotenv").config();

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, "data"));

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const config = {
  rootDir,
  port: numberEnv("PORT", 3000),
  baseUrl: process.env.APP_BASE_URL || "http://localhost:3000",
  appSecret: process.env.APP_SECRET || "development-only-secret-change-me",
  dataDir,
  dbPath: path.resolve(process.env.DATABASE_PATH || path.join(dataDir, "folder-app.sqlite")),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(dataDir, "uploads")),
  storageDriver: process.env.STORAGE_DRIVER || "local",
  cloudinaryFolder: process.env.CLOUDINARY_FOLDER || "quick-folder",
  maxFileSizeBytes: numberEnv("MAX_FILE_SIZE_MB", 50) * 1024 * 1024,
  maxTextSizeBytes: numberEnv("MAX_TEXT_SIZE_MB", 10) * 1024 * 1024,
  maxFilesPerPost: numberEnv("MAX_FILES_PER_POST", 10),
  rateLimitWindowMs: numberEnv("RATE_LIMIT_WINDOW_MS", 60_000),
  rateLimitMax: numberEnv("RATE_LIMIT_MAX", 30),
  cleanupIntervalMs: numberEnv("CLEANUP_INTERVAL_MINUTES", 15) * 60 * 1000,
  enablePermanentRetention: process.env.ENABLE_PERMANENT_RETENTION === "true",
  adminUsername: process.env.ADMIN_USERNAME || "",
  adminPassword1: process.env.ADMIN_PASSWORD_1 || "",
  adminPassword2: process.env.ADMIN_PASSWORD_2 || ""
};

config.adminEnabled = Boolean(config.adminUsername && config.adminPassword1 && config.adminPassword2);

const retentionOptions = [
  { label: "24 hours", value: "24h", milliseconds: 24 * 60 * 60 * 1000 },
  { label: "3 days", value: "3d", milliseconds: 3 * 24 * 60 * 60 * 1000 },
  { label: "7 days", value: "7d", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { label: "1 month", value: "1mo", milliseconds: 30 * 24 * 60 * 60 * 1000 },
  { label: "6 months", value: "6mo", milliseconds: 182 * 24 * 60 * 60 * 1000 },
  { label: "1 year", value: "1y", milliseconds: 365 * 24 * 60 * 60 * 1000 }
];

if (config.enablePermanentRetention) {
  retentionOptions.push({ label: "Never delete", value: "permanent", milliseconds: null });
}

function getDeleteAt(retentionValue) {
  const option = retentionOptions.find((item) => item.value === retentionValue);
  if (!option) return null;
  if (option.milliseconds === null) return null;
  return new Date(Date.now() + option.milliseconds).toISOString();
}

module.exports = { config, retentionOptions, getDeleteAt };
