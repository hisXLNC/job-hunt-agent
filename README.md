# Job Hunt

A Windows app that looks for jobs that fit your CV every day, rewrites your CV and a cover letter
for each one, keeps track of every application, sorts your job email and puts interviews in your
calendar.

Nothing is sent without your click. Replies are saved as Gmail drafts for you to check.

**New here? Read [GETTING-STARTED.md](GETTING-STARTED.md):** about ten minutes, no technical
knowledge needed.

## What you need

- A Windows PC.
- A **Claude** subscription (Pro or Max) from claude.ai. Job Hunt uses it to read postings and write
  your CV changes. (No subscription? A Claude API key works too; you pay per use.)
- Your **CV** as a Word file, PDF or text.
- Optional: a **Google** account, so Job Hunt can read your job email, draft replies and add
  interviews to your calendar.

## Install

Download **JobHunt-Setup.exe** from the
[latest release](https://github.com/hisXLNC/job-hunt-releases/releases/latest) and run it. It
installs just for you (no administrator rights needed) and opens. Windows may say "Windows protected
your PC" because the installer isn't signed: click **More info → Run anyway**.

The Welcome page then takes you through five steps: Claude (one button installs it and signs you
in), your CV, where you want to work, where to look, and your first search.

## Every day

- **Overview:** new roles that fit, ready for you to pick; what's waiting for your go-ahead; what's
  coming up.
- **Pick roles** and Job Hunt tailors your CV and a cover letter for each. Read them, change anything,
  then **Approve**.
- **Apply:** Job Hunt opens the company's form and fills it in. You check it and press Submit. When
  the site confirms, Job Hunt marks it applied (or press **I submitted it**).
- **Email:** replies from employers are sorted and matched to the application; interview requests
  get a draft reply with times that suit you.
- Closing the window keeps Job Hunt running in the tray (next to the clock), so searches and email
  checks carry on. It starts with Windows; you can change both in Settings → App.

## Good to know

- **Your data stays yours:** it's on your PC (`%LOCALAPPDATA%\Job Hunt\data`) and, if you turn on
  sync, in your own Google Drive. Nothing is published or sent to whoever shared the app; see
  [PRIVACY.md](PRIVACY.md). Updating or uninstalling never deletes it.
- **Updates** arrive by themselves: you get a notice and an **Install and restart** button.
- **Another computer:** Settings → App → Sync between computers → Straight to Google Drive. Install
  Job Hunt on the other PC and connect the same Google account: it offers to continue where you left
  off.
- **Backups:** one zip a day with everything, the last 14 kept (Settings → App → Backups).
- **Giving it to a friend:** they install their own copy and use their own Claude and Google. See
  [SHARING.md](SHARING.md).
- **On a server, with your PC off:** possible, but technical. See [server/ORACLE.md](server/ORACLE.md)
  or [server/README.md](server/README.md) (a Synology NAS).

## What it does, and doesn't

| | |
|---|---|
| **Search** | Every day, company job boards near you, job sites you turn on (LinkedIn, Google for Jobs, recruiters), and job-alert emails. Duplicates and roles in the wrong place or field are set aside. |
| **Score** | Claude rates each new posting 0–100 against your CV and says why. |
| **Tailor** | For roles you pick, Claude rewrites your headline, summary, skills and bullets in the posting's own words, and writes a cover letter. Both are Word files built from your own CV, so the look stays yours. |
| **Track** | Every application with its stage, what was sent, replies, recruiters and follow-ups. |
| **Email and calendar** | Job email is labelled and matched; confirmed interviews go in your calendar with prep time and reminders. |

**It never makes things up.** You'll be interviewed on your CV, so tailoring only rephrases what's
there: your name, job titles, dates and education are locked, a figure your CV doesn't state is
refused, and a skill you don't have is listed as a gap instead of being added.

**It doesn't press Submit for you.** Job sites ban accounts that apply by bot, and you should see
what goes out under your name. Job Hunt fills the form; submitting takes a minute.

Working on the code? See [DEVELOPING.md](DEVELOPING.md).
