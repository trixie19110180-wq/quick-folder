const db = require("./db");
const { deleteStoredFile, removeLocalPostDir } = require("./storage");

async function removePostFiles(postId) {
  const files = db.prepare("SELECT * FROM files WHERE post_id = ?").all(postId);
  for (const file of files) {
    await deleteStoredFile(file);
  }
  removeLocalPostDir(postId);
}

async function cleanupExpiredPosts() {
  const expired = db
    .prepare("SELECT id FROM posts WHERE delete_at IS NOT NULL AND delete_at <= ?")
    .all(new Date().toISOString());

  for (const post of expired) {
    await removePostFiles(post.id);
    db.prepare("DELETE FROM posts WHERE id = ?").run(post.id);
  }

  return expired.length;
}

function startCleanupJob() {
  const { config } = require("./config");
  cleanupExpiredPosts().catch((err) => console.error("Cleanup failed:", err));
  const timer = setInterval(() => {
    cleanupExpiredPosts().catch((err) => console.error("Cleanup failed:", err));
  }, config.cleanupIntervalMs);
  timer.unref();
}

module.exports = { cleanupExpiredPosts, startCleanupJob, removePostFiles };

if (require.main === module) {
  cleanupExpiredPosts().then((deleted) => {
    console.log(`Deleted ${deleted} expired post${deleted === 1 ? "" : "s"}.`);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
