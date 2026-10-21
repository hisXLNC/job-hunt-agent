# Job Hunt on a Synology NAS

> **This is the technical way,** for people comfortable with Docker and their NAS. Everyone else: use the
> Windows app (see [GETTING-STARTED.md](../GETTING-STARTED.md)).

Job Hunt runs on your NAS all day, free and private, and you use it from a web browser on your phone or
any computer. Searches, tailoring, email checks and backups run on the NAS, so your PC can be off.

You need a Synology that can run **Container Manager** (most "+" models and recent DS models; check
Package Center). It runs on Intel/AMD and ARM64 models.

## 1. Get two things from your PC

1. **A backup with your sign-ins.** In the Windows app: Settings → App → Backups → tick *Include saved keys
   and sign-ins* → **Back up now** → **Download** (or take the zip from the backup folder).
2. **A Claude sign-in for the server** (to use your Claude subscription). In PowerShell on the PC run:

   ```
   claude setup-token
   ```

   Sign in when your browser opens and copy the long token it prints. (Or skip this and use a Claude API
   key: set it in Job Hunt → Settings → Accounts once the server runs.)

## 2. Set up the container

1. Package Center → install **Container Manager**.
2. File Station → in the `docker` shared folder, create `job-hunt`, and inside it `data` and `backups`.
3. Container Manager → **Project** → **Create**. Name `job-hunt`, path `docker/job-hunt`, source
   *Create docker-compose.yml*, and paste in [`docker-compose.yml`](docker-compose.yml).
   Fill in `JOBHUNT_PASSWORD` (8+ characters) and `CLAUDE_CODE_OAUTH_TOKEN` (the token from step 1.2),
   and change `/volume1/docker` if your shared folder is elsewhere. Click **Next** → **Done**: it downloads
   the image and starts Job Hunt.

## 3. Reach it privately from anywhere

1. Package Center → install **Tailscale** → open it and sign in.
2. Install Tailscale on your phone (and laptop) and sign in with the same account.
3. Open `http://<your NAS name>:8790` (the name Tailscale shows for the NAS) and sign in with your password.

Only devices signed in to your Tailscale account can reach it; nothing is opened to the internet.

## 4. Bring your data over

In Job Hunt on the NAS: Settings → App → Backups → **Restore from a backup…** → choose the zip from step 1.1.
Job Hunt restarts with your CVs, applications, settings and Google sign-in.

Then pick one place to run it: **exit the Windows app** (tray icon → Exit, and untick "Start when I sign in"),
or both will search and handle your email. You can still use the PC through the browser.

## Backups

The server backs up daily to `docker/job-hunt/backups` and keeps the last 14. To copy them off the NAS too,
point **Hyper Backup** or **Cloud Sync** (OneDrive, Google Drive) at that folder.

## Updates

When Settings → App says a new version is out: Container Manager → **Project** → `job-hunt` → **Action** →
**Build** (it pulls the newest image and restarts). Your data stays in `docker/job-hunt/data`.

## Good to know

- **Google sign-in** happens in the Windows app; the restore brings it to the server. To reconnect Google later,
  connect it on the PC and restore again (or re-create the server's data from a fresh backup).
- **PDFs** are made with LibreOffice inside the container.
- **Indeed search** needs your Claude subscription sign-in (`CLAUDE_CODE_OAUTH_TOKEN`) and the Indeed connector on
  your Claude account.
