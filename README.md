# QuickFolder

QuickFolder is a small no-login web app for moving files or text between computers. People can create public posts or password-protected posts, then open a shareable link later from another computer.

## Features

- Public feed with preview-only cards
- `+` button for creating file or text posts
- Multiple file uploads with browser upload progress
- Large text posts using an uncontrolled textarea to avoid typing and paste lag
- Password-protected posts with hashed passwords
- Unique shareable link for every post
- Auto-delete choices: 24 hours, 3 days, 7 days, 1 month, 6 months, 1 year
- Permanent posts are disabled unless `ENABLE_PERMANENT_RETENTION=true`
- SQLite database and local file storage
- Basic rate limiting, upload validation, attachment-only downloads, and XSS-safe rendering
- Background cleanup job for expired posts and uploaded files

## Local Setup

Install Node.js 20 or newer first. Then run:

```bash
cd ~/Documents/folder-app
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

To run in production mode locally:

```bash
npm install
npm start
```

## Environment Variables

| Name | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Web server port |
| `APP_BASE_URL` | `http://localhost:3000` | Used to display share links |
| `APP_SECRET` | development fallback | Used to sign unlock cookies |
| `DATA_DIR` | `./data` | Base folder for SQLite and uploads |
| `DATABASE_PATH` | `$DATA_DIR/folder-app.sqlite` | Optional custom SQLite file path |
| `UPLOAD_DIR` | `$DATA_DIR/uploads` | Optional custom uploaded-file folder |
| `MAX_FILE_SIZE_MB` | `50` | Maximum size of each uploaded file |
| `MAX_TEXT_SIZE_MB` | `10` | Maximum text-post size |
| `MAX_FILES_PER_POST` | `10` | Maximum files per file post |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window |
| `RATE_LIMIT_MAX` | `30` | Max create requests per window per IP |
| `CLEANUP_INTERVAL_MINUTES` | `15` | Expired-post cleanup interval |
| `ENABLE_PERMANENT_RETENTION` | `false` | Adds a "Never delete" option when set to `true` |
| `ADMIN_USERNAME` | blank | Enables admin login when all admin fields are set |
| `ADMIN_PASSWORD_1` | blank | First admin password field |
| `ADMIN_PASSWORD_2` | blank | Second admin password field |

## Admin Delete Access

Admin login is disabled until these environment variables are set:

```bash
ADMIN_USERNAME=<your admin username>
ADMIN_PASSWORD_1=<your first admin password>
ADMIN_PASSWORD_2=<your second admin password>
```

To trigger the admin command, open `/admin` on your site, enter those three values, and submit the form. After login, `/admin/posts` shows every post with a delete button. Admin users can also open an individual post and delete it there.

Do not put these values in GitHub. Add them to your local `.env` file and to Render's environment variables.

## Render Deployment From GitHub

### 1. Create a Git repository

```bash
cd ~/Documents/folder-app
git init
git add .
git commit -m "Initial QuickFolder app"
```

### 2. Push to GitHub

If you have the GitHub CLI installed:

```bash
gh auth login
gh repo create quick-folder --public --source=. --remote=origin --push
```

If you do not use the GitHub CLI:

```bash
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/quick-folder.git
git push -u origin main
```

Create the empty GitHub repo in your browser before running the second set of commands.

### 3. Deploy on Render with the blueprint

1. Go to Render and choose **New +**.
2. Choose **Blueprint**.
3. Connect the GitHub repo.
4. Render will read `render.yaml`.
5. Render will create a free Node web service.
6. After the first deploy, set `APP_BASE_URL` to your Render URL, for example `https://your-app.onrender.com`.
7. Keep `DATA_DIR=./data` on the free plan.

### 4. Add admin environment variables on Render

In the Render service, open **Environment** and add:

```bash
ADMIN_USERNAME=<your admin username>
ADMIN_PASSWORD_1=<your first admin password>
ADMIN_PASSWORD_2=<your second admin password>
```

Then click **Manual Deploy** > **Deploy latest commit**.

### Manual Render setup

You can also create a Render Web Service manually:

- Build command: `npm install`
- Start command: `npm start`
- Environment variables:
  - `NODE_ENV=production`
  - `DATA_DIR=./data`
  - `APP_SECRET=<a long random value>`
  - `APP_BASE_URL=<your Render URL>`
  - `ADMIN_USERNAME=Trixie`
  - `ADMIN_PASSWORD_1=<your first admin password>`
  - `ADMIN_PASSWORD_2=<your second admin password>`

## Storage Notes

SQLite plus local Render Free storage is simple for testing, but uploaded files and posts are not guaranteed permanent on the free plan. For reliable storage, upgrade the service and add a persistent disk mounted at `/var/data`, then set `DATA_DIR=/var/data`. For heavy public use, switch file storage to object storage and add moderation/admin tools before enabling permanent posts.

## Security Notes

This app intentionally has no accounts. Passwords are hashed with Node's `scrypt` before storage. Uploaded files are downloaded as attachments with `nosniff`, and common executable extensions are blocked. Text is never rendered as HTML; previews are escaped by the template engine and full text is inserted with `textContent`.
