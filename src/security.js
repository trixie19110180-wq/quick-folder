const crypto = require("crypto");
const path = require("path");
const { config } = require("./config");

const blockedExtensions = new Set([
  ".app",
  ".bat",
  ".cmd",
  ".com",
  ".cpl",
  ".dll",
  ".dmg",
  ".exe",
  ".gadget",
  ".hta",
  ".jar",
  ".js",
  ".jse",
  ".msi",
  ".msp",
  ".pif",
  ".ps1",
  ".scr",
  ".sh",
  ".vb",
  ".vbe",
  ".vbs",
  ".wsf"
]);

function randomSlug() {
  return crypto.randomBytes(9).toString("base64url");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = crypto.scryptSync(password, salt, 64).toString("base64url");
  return `scrypt:${salt}:${key}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.startsWith("scrypt:")) return false;
  const [, salt, expected] = storedHash.split(":");
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "base64url");
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(expectedBuffer, actual);
}

function signUnlock(slug) {
  return crypto.createHmac("sha256", config.appSecret).update(slug).digest("base64url");
}

function signAdmin() {
  return crypto.createHmac("sha256", config.appSecret).update("admin").digest("base64url");
}

function constantTimeStringEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function hasUnlockCookie(req, slug) {
  return req.cookies[`unlock_${slug}`] === signUnlock(slug);
}

function isAdmin(req) {
  return config.adminEnabled && req.cookies.folder_admin === signAdmin();
}

function setUnlockCookie(res, slug) {
  res.cookie(`unlock_${slug}`, signUnlock(slug), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

function setAdminCookie(res) {
  res.cookie("folder_admin", signAdmin(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60 * 1000
  });
}

function clearAdminCookie(res) {
  res.clearCookie("folder_admin");
}

function sanitizeFilename(name) {
  const base = path.basename(name || "download");
  return base.replace(/[^\w.\- ()]/g, "_").slice(0, 160) || "download";
}

function validateUploadName(name) {
  const ext = path.extname(name || "").toLowerCase();
  if (blockedExtensions.has(ext)) {
    return `Files ending in ${ext} are not allowed.`;
  }
  return null;
}

function wantsPassword(body) {
  return body.visibility === "protected";
}

module.exports = {
  randomSlug,
  hashPassword,
  verifyPassword,
  signUnlock,
  signAdmin,
  constantTimeStringEqual,
  hasUnlockCookie,
  isAdmin,
  setUnlockCookie,
  setAdminCookie,
  clearAdminCookie,
  sanitizeFilename,
  validateUploadName,
  wantsPassword
};
