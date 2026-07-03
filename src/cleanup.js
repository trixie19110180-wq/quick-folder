const fs = require("fs");
const path = require("path");
const db = require("./db");
const { config } = require("./config");

function removePostFiles(postId) {
  const dir = path.join(config.uploadDir, String(postId));
  fs.rmSync(dir, { recursive: true, force: true });
}

function cleanupExpiredPosts() {
  const expired = db
    .prepare("SELECT id FROM posts WHERE delete_at IS NOT NULL AND delete_at <= ?")
    .all(new Date().toISOString());

  const deletePost = db.prepare("DELETE FROM posts WHERE id = ?");
  const transaction = db.transaction((posts) => {
    for (const post of posts) {
      deletePost.run(post.id);
    }
  });

  transaction(expired);

  for (const post of expired) {
    removePostFiles(post.id);
  }

  return expired.length;
}

function startCleanupJob() {
  cleanupExpiredPosts();
  const timer = setInterval(cleanupExpiredPosts, config.cleanupIntervalMs);
  timer.unref();
}

module.exports = { cleanupExpiredPosts, startCleanupJob, removePostFiles };

if (require.main === module) {
  const deleted = cleanupExpiredPosts();
  console.log(`Deleted ${deleted} expired post${deleted === 1 ? "" : "s"}.`);
}
