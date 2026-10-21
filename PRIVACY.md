# Your data in Job Hunt

Job Hunt keeps everything about you private. Nothing is sent to whoever made or shared the app, and
nothing is published anywhere.

## Where your things are kept

| What | Where |
|---|---|
| Your CVs, applications, cover letters, notes, settings | On your computer, in `%LOCALAPPDATA%\Job Hunt\data` (or the server's `data` folder if you run it there). |
| Backups (one zip a day, last 14 kept) | On your computer, or in a folder you choose, such as your own OneDrive or Google Drive folder. |
| Sync between computers (if you turn it on) | A "Job Hunt" folder in **your own** Google Drive. Files there are private to you; Job Hunt never shares them, and it can only see the files it made, not your others. |
| Saved keys and sign-ins | On your computer. They go into backups and sync only if you tick *Include saved keys and sign-ins*, and then only to your own folder or Drive. |

## Who sees what, and why

- **Claude (Anthropic)**, through your own Claude account or API key: your CV, the postings and your
  job email, so it can score roles, tailor your CV and sort your mail. That's under your account and
  Anthropic's privacy terms, like using Claude yourself.
- **Google**, through your own Google account: Job Hunt reads and labels job email, saves drafts, adds
  interviews to your calendar and keeps the sync copy in your Drive. Everything stays in your account.
- **Job sites** (LinkedIn, Google for Jobs and the others) see searches for job titles in your
  places, as a browser would. They aren't told who you are.
- **Phone notifications** (if you turn them on) go through ntfy.sh, a public relay. By default they
  only say what kind of notice it is ("An interview update"), never the company, role or person.
  You can choose to include details, or use your own ntfy server.

## The code

Job Hunt's code is public, but it holds no one's data: only made-up examples (jane@example.com and
the like). Every release is checked for personal email addresses before it's published.
