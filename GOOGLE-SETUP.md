# Build Google into Job Hunt (once, about 15 minutes)

Do this once, as the person who shares Job Hunt. Afterwards everyone who installs it (you and your
friends) connects Gmail, Calendar and Drive with **one button**: no Google Cloud, no files.

Until it's done, each person has to choose a "Google connection file" in Settings → Accounts before
they can connect (you can send them the file from step 5 instead; see the end).

## 1. Make a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in with your Google
   account.
2. At the top, click the project picker → **New project**. Name it `Job Hunt` → **Create**. Make sure
   it's selected at the top afterwards.

## 2. Turn on Gmail, Calendar and Drive

1. Menu (☰) → **APIs & Services → Library**.
2. Search **Gmail API** → open it → **Enable**.
3. Back to the Library: **Google Calendar API** → **Enable**.
4. Back again: **Google Drive API** → **Enable**.

## 3. Describe the app to Google

1. Menu → **Google Auth Platform** (or **APIs & Services → OAuth consent screen**) → **Get started**.
2. App name `Job Hunt`, user support email: yours → **Next**.
3. Audience: **External** → **Next**. Contact email: yours → **Next** → agree → **Create**.
4. **Data access → Add or remove scopes**. Paste these four into *Manually add scopes*, one per line,
   then **Add to table → Update → Save**:
   ```
   https://www.googleapis.com/auth/gmail.modify
   https://www.googleapis.com/auth/calendar.events
   https://www.googleapis.com/auth/calendar.freebusy
   https://www.googleapis.com/auth/drive.file
   ```
5. **Audience → Publish app → Confirm**, so the status says *In production*. (Left in *Testing*,
   Google signs everyone out every 7 days and only lets in people you list as test users.)

Google will show people a "hasn't verified this app" page when they connect; Job Hunt tells them to
click **Advanced → Go to Job Hunt**. Up to 100 people can use an unverified app, plenty for friends.

## 4. Make the connection file

1. **Clients → Create client**. Application type **Desktop app**, name `Job Hunt` → **Create**.
2. **Download JSON**. That file is the connection file. (For desktop apps Google doesn't treat what's
   in it as secret: it only says which app is asking. Each person still signs in to their own account.)

## 5. Build it into Job Hunt

1. Open the file you downloaded in Notepad and copy everything in it.
2. On GitHub: **hisXLNC/job-hunt-agent → Settings → Secrets and variables → Actions → New repository
   secret**. Name: `GOOGLE_CLIENT_JSON`. Secret: paste. **Add secret**.
3. The next release (any version bump) includes it, for the Windows app and the server. Everyone's
   Settings → Accounts then shows just **Connect Google**.

## Without rebuilding: send the file

You can also give the downloaded file to a friend directly (email or chat). In Job Hunt they open
Settings → Accounts → **Choose the connection file**, pick it, and press **Connect Google**.
