const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const db = require("./db");
const { config, retentionOptions, getDeleteAt } = require("./config");
const { startCleanupJob, removePostFiles } = require("./cleanup");
const {
  randomSlug,
  hashPassword,
  verifyPassword,
  constantTimeStringEqual,
  hasUnlockCookie,
  isAdmin,
  setUnlockCookie,
  setAdminCookie,
  clearAdminCookie,
  sanitizeFilename,
  validateUploadName,
  wantsPassword
} = require("./security");

fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(path.join(config.uploadDir, "staging"), { recursive: true });

const app = express();
app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(config.rootDir, "views"));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"]
      }
    }
  })
);
app.use(cookieParser());
app.use(express.static(path.join(config.rootDir, "public"), { maxAge: "1h" }));
app.use(express.urlencoded({ extended: false, limit: `${Math.ceil(config.maxTextSizeBytes / 1024 / 1024)}mb` }));
app.use((req, res, next) => {
  res.locals.isAdmin = isAdmin(req);
  next();
});

const createLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute and try again." }
});

const unlockLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: Math.max(10, Math.floor(config.rateLimitMax / 2)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many unlock attempts. Please wait and try again." }
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(config.uploadDir, "staging")),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomSlug()}${path.extname(file.originalname)}`)
  }),
  limits: {
    fileSize: config.maxFileSizeBytes,
    files: config.maxFilesPerPost,
    fieldSize: config.maxTextSizeBytes
  },
  fileFilter: (_req, file, cb) => {
    const message = validateUploadName(file.originalname);
    cb(message ? new Error(message) : null, !message);
  }
});

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function retentionLabel(deleteAt) {
  if (!deleteAt) return "No automatic deletion";
  const ms = new Date(deleteAt).getTime() - Date.now();
  if (ms <= 0) return "Deleting soon";
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return days <= 1 ? "Deletes within 24 hours" : `Deletes in ${days} days`;
}

function getPostBySlug(slug) {
  return db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM files f WHERE f.post_id = p.id) AS file_count,
        (SELECT COALESCE(SUM(size), 0) FROM files f WHERE f.post_id = p.id) AS total_file_bytes
       FROM posts p
       WHERE p.slug = ?
         AND (p.delete_at IS NULL OR p.delete_at > ?)`
    )
    .get(slug, new Date().toISOString());
}

function canAccessPost(req, post) {
  return isAdmin(req) || !post.password_hash || hasUnlockCookie(req, post.slug);
}

function validatePostOptions(body) {
  const retention = retentionOptions.find((option) => option.value === body.retention);
  if (!retention) return "Choose when this post should be deleted.";
  if (wantsPassword(body) && !String(body.password || "").trim()) {
    return "Set a password for protected posts.";
  }
  return null;
}

function buildPasswordHash(body) {
  return wantsPassword(body) ? hashPassword(String(body.password)) : null;
}

function cleanupUploadedFiles(files) {
  for (const file of files || []) {
    fs.rmSync(file.path, { force: true });
  }
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  return res.redirect("/admin");
}

function deletePostBySlug(slug) {
  const post = db.prepare("SELECT id FROM posts WHERE slug = ?").get(slug);
  if (!post) return false;
  db.prepare("DELETE FROM posts WHERE id = ?").run(post.id);
  removePostFiles(post.id);
  return true;
}

app.locals.formatBytes = formatBytes;
app.locals.retentionLabel = retentionLabel;
app.locals.baseUrl = config.baseUrl;

app.get("/", (req, res) => {
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = 20;
  const offset = (page - 1) * limit;
  const posts = db
    .prepare(
      `SELECT p.id, p.slug, p.kind, p.password_hash, p.delete_at, p.created_at, p.text_preview, p.text_bytes,
        (SELECT COUNT(*) FROM files f WHERE f.post_id = p.id) AS file_count,
        (SELECT COALESCE(SUM(size), 0) FROM files f WHERE f.post_id = p.id) AS total_file_bytes
       FROM posts p
       WHERE p.delete_at IS NULL OR p.delete_at > ?
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(new Date().toISOString(), limit + 1, offset);

  res.render("index", {
    title: "Folder App",
    posts: posts.slice(0, limit),
    page,
    hasNext: posts.length > limit
  });
});

app.get("/new", (_req, res) => {
  res.render("new", {
    title: "New post",
    retentionOptions,
    maxFileSize: formatBytes(config.maxFileSizeBytes),
    maxTextSize: formatBytes(config.maxTextSizeBytes),
    maxFilesPerPost: config.maxFilesPerPost
  });
});

app.get("/admin", (req, res) => {
  if (isAdmin(req)) return res.redirect("/admin/posts");
  res.render("admin-login", {
    title: "Admin",
    adminEnabled: config.adminEnabled
  });
});

app.post("/admin/login", unlockLimiter, express.urlencoded({ extended: false }), (req, res) => {
  if (!config.adminEnabled) {
    return res.status(403).render("admin-login", {
      title: "Admin",
      adminEnabled: false,
      error: "Admin login is disabled. Set the admin environment variables first."
    });
  }

  const valid = constantTimeStringEqual(req.body.username, config.adminUsername)
    && constantTimeStringEqual(req.body.password1, config.adminPassword1)
    && constantTimeStringEqual(req.body.password2, config.adminPassword2);

  if (!valid) {
    return res.status(401).render("admin-login", {
      title: "Admin",
      adminEnabled: true,
      error: "The admin details did not match."
    });
  }

  setAdminCookie(res);
  res.redirect("/admin/posts");
});

app.post("/admin/logout", requireAdmin, (_req, res) => {
  clearAdminCookie(res);
  res.redirect("/");
});

app.get("/admin/posts", requireAdmin, (req, res) => {
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = 50;
  const offset = (page - 1) * limit;
  const posts = db
    .prepare(
      `SELECT p.id, p.slug, p.kind, p.password_hash, p.delete_at, p.created_at, p.text_preview, p.text_bytes,
        (SELECT COUNT(*) FROM files f WHERE f.post_id = p.id) AS file_count,
        (SELECT COALESCE(SUM(size), 0) FROM files f WHERE f.post_id = p.id) AS total_file_bytes
       FROM posts p
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit + 1, offset);

  res.render("admin-posts", {
    title: "Admin posts",
    posts: posts.slice(0, limit),
    page,
    hasNext: posts.length > limit
  });
});

app.post("/admin/posts/:slug/delete", requireAdmin, (req, res) => {
  deletePostBySlug(req.params.slug);
  const nextUrl = req.body.next || "/admin/posts";
  res.redirect(nextUrl.startsWith("/") ? nextUrl : "/admin/posts");
});

app.post("/api/posts/text", createLimiter, upload.none(), (req, res) => {
  const error = validatePostOptions(req.body);
  const text = String(req.body.text || "");
  const bytes = Buffer.byteLength(text, "utf8");
  if (error) return res.status(400).json({ error });
  if (!text.trim()) return res.status(400).json({ error: "Paste some text before posting." });
  if (bytes > config.maxTextSizeBytes) return res.status(413).json({ error: "Text is larger than the allowed limit." });

  const slug = randomSlug();
  const preview = text.replace(/\s+/g, " ").trim().slice(0, 260);
  const insert = db.prepare(
    `INSERT INTO posts (slug, kind, password_hash, delete_at, text_content, text_preview, text_bytes)
     VALUES (?, 'text', ?, ?, ?, ?, ?)`
  );

  insert.run(slug, buildPasswordHash(req.body), getDeleteAt(req.body.retention), text, preview, bytes);
  res.json({ url: `/p/${slug}` });
});

app.post("/api/posts/files", createLimiter, upload.array("files", config.maxFilesPerPost), (req, res) => {
  const files = req.files || [];
  const error = validatePostOptions(req.body);
  if (error) {
    cleanupUploadedFiles(files);
    return res.status(400).json({ error });
  }
  if (files.length === 0) return res.status(400).json({ error: "Choose at least one file." });

  const slug = randomSlug();
  const createPost = db.prepare(
    `INSERT INTO posts (slug, kind, password_hash, delete_at)
     VALUES (?, 'file', ?, ?)`
  );
  const createFile = db.prepare(
    `INSERT INTO files (post_id, original_name, stored_name, size, mime_type)
     VALUES (?, ?, ?, ?, ?)`
  );

  const transaction = db.transaction(() => {
    const result = createPost.run(slug, buildPasswordHash(req.body), getDeleteAt(req.body.retention));
    const postId = result.lastInsertRowid;
    const postDir = path.join(config.uploadDir, String(postId));
    fs.mkdirSync(postDir, { recursive: true });

    for (const file of files) {
      const safeOriginal = sanitizeFilename(file.originalname);
      const safeStored = sanitizeFilename(file.filename);
      fs.renameSync(file.path, path.join(postDir, safeStored));
      createFile.run(postId, safeOriginal, safeStored, file.size, file.mimetype || "application/octet-stream");
    }
  });

  try {
    transaction();
    res.json({ url: `/p/${slug}` });
  } catch (err) {
    cleanupUploadedFiles(files);
    throw err;
  }
});

app.get("/p/:slug", (req, res, next) => {
  const post = getPostBySlug(req.params.slug);
  if (!post) return next();
  const hasAccess = canAccessPost(req, post);
  const files = hasAccess && post.kind === "file"
    ? db.prepare("SELECT id, original_name, size FROM files WHERE post_id = ? ORDER BY id ASC").all(post.id)
    : [];

  res.render("post", {
    title: "Shared post",
    post,
    files,
    hasAccess,
    shareUrl: `${config.baseUrl.replace(/\/$/, "")}/p/${post.slug}`
  });
});

app.post("/p/:slug/unlock", unlockLimiter, express.urlencoded({ extended: false }), (req, res, next) => {
  const post = getPostBySlug(req.params.slug);
  if (!post) return next();
  if (!post.password_hash) return res.redirect(`/p/${post.slug}`);
  if (!verifyPassword(String(req.body.password || ""), post.password_hash)) {
    return res.status(401).render("post", {
      title: "Shared post",
      post,
      files: [],
      hasAccess: false,
      shareUrl: `${config.baseUrl.replace(/\/$/, "")}/p/${post.slug}`,
      unlockError: "That password did not work."
    });
  }
  setUnlockCookie(res, post.slug);
  res.redirect(`/p/${post.slug}`);
});

app.get("/api/posts/:slug/text", (req, res, next) => {
  const post = getPostBySlug(req.params.slug);
  if (!post || post.kind !== "text") return next();
  if (!canAccessPost(req, post)) return res.status(403).json({ error: "Password required." });
  const row = db.prepare("SELECT text_content FROM posts WHERE id = ?").get(post.id);
  res.json({ text: row.text_content || "" });
});

app.get("/p/:slug/text.txt", (req, res, next) => {
  const post = getPostBySlug(req.params.slug);
  if (!post || post.kind !== "text") return next();
  if (!canAccessPost(req, post)) return res.status(403).send("Password required.");
  const row = db.prepare("SELECT text_content FROM posts WHERE id = ?").get(post.id);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${post.slug}.txt"`);
  res.send(row.text_content || "");
});

app.get("/p/:slug/files/:fileId/download", (req, res, next) => {
  const post = getPostBySlug(req.params.slug);
  if (!post || post.kind !== "file") return next();
  if (!canAccessPost(req, post)) return res.status(403).send("Password required.");
  const file = db.prepare("SELECT * FROM files WHERE id = ? AND post_id = ?").get(req.params.fileId, post.id);
  if (!file) return next();
  const filePath = path.join(config.uploadDir, String(post.id), file.stored_name);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", "application/octet-stream");
  res.download(filePath, file.original_name);
});

app.use((req, res) => {
  res.status(404).render("error", { title: "Not found", message: "That page or post was not found." });
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE"
      ? `A file is larger than ${formatBytes(config.maxFileSizeBytes)}.`
      : err.message;
    return res.status(400).json({ error: message });
  }
  console.error(err);
  res.status(500).format({
    json: () => res.json({ error: "Something went wrong." }),
    html: () => res.render("error", { title: "Error", message: "Something went wrong." })
  });
});

startCleanupJob();

app.listen(config.port, () => {
  console.log(`Folder App running on http://localhost:${config.port}`);
});
