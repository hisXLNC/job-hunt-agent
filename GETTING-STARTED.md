# Getting started with Job Hunt

About ten minutes. You don't need to know anything technical. Have these ready:

- **Your CV** as a Word file (.docx), PDF or text.
- **A Claude subscription** (Pro or Max, from [claude.ai](https://claude.ai)). It's what reads the
  job postings and rewrites your CV. No subscription? You can use a Claude API key instead and pay
  per use (see the end).
- Optional: **your Gmail account**, so Job Hunt can sort your job email and add interviews to your
  calendar.

## 1. Install Job Hunt

1. Download **JobHunt-Setup.exe** from the
   [latest release](https://github.com/hisXLNC/job-hunt-releases/releases/latest).
2. Open it. If Windows says **"Windows protected your PC"**, click **More info**, then **Run
   anyway**. (It says that for any app that isn't signed with a paid certificate.)
3. Job Hunt opens on its **Welcome** page. It also starts by itself when you turn on your PC, and
   keeps running in the tray, the small icons next to the clock.

## 2. Connect Claude

On the Welcome page, step 1, press **Install and sign in**.

- A blue window opens and installs Claude Code, a free helper from Anthropic (a minute or two).
- Your browser then opens and asks you to sign in to Claude. Sign in with your Claude account and
  press **Authorize**.
- Close the blue window when it says **All done**. Job Hunt notices by itself and ticks step 1.

If the blue window asks you to pick a colour style or press Enter, just press Enter.

## 3. Add your CV

Step 2: press **Add CVs** and choose your CV. Claude reads it and suggests the job titles to search
for (you can change them later in Settings → Your CVs). Looking for two kinds of jobs? Add a CV for
each.

## 4. Where you want to work

Step 3: pick your city from the list (or type it and press Enter; add as many as you like), check the country and time zone, tick
**Include remote roles** if you'd like those too, and press **Save**.

## 5. Connect Google (optional, recommended)

Step 4 → **Connect Gmail** → **Connect Google**. (**Choose job sources**, next to it, lets you add LinkedIn, Job Bank, recruiters and more: each has a Turn on button.)

- If Job Hunt first asks for a **connection file**, ask the person who gave you Job Hunt for it (a small
  file ending in .json), save it, press **Choose the connection file** and pick it.
- Press **Connect Google**. Your browser opens. Sign in with your Gmail account.
- Google shows a warning: **"Google hasn't verified this app"**. That's expected for a small app
  like this. Click **Advanced**, then **Go to Job Hunt**.
- Tick the boxes to allow Gmail, Calendar and Drive, and press **Continue**.
- If Google says **you don't have access**, ask the person who gave you Job Hunt to add your Gmail
  address, then try again.

Job Hunt can only see the files it makes in your Google Drive, not your others.

## 6. Your first search

Step 5: **Search for jobs now**. It takes a few minutes. Roles that fit appear on the **Overview**:

1. Tick the ones you like and press **Tailor selected**. Job Hunt rewrites your CV and writes a cover letter
   for each (a few minutes; you get a notification).
2. Open each one (**Check and approve**), read it, change anything you want, and press **Approve and apply**.
3. Press **Apply**. Job Hunt opens the company's form and fills it in. Check it, then press the
   site's own **Submit** button. When the site confirms, Job Hunt marks it as applied.

From then on Job Hunt searches every morning and checks your email every half hour.

## If something says "Needs attention"

The Overview tells you in plain words, with a button that fixes it or takes you there. Common ones:

- **"Your Claude usage limit is reached until …"**: nothing's broken. Your Claude plan allows so much
  use every few hours; Job Hunt waits and carries on by itself.
- **"Google is disconnected"**: press **Reconnect Google** in Settings → Accounts.
- **"Claude isn't ready"**: Settings → Accounts → **Sign in to Claude**.

## No Claude subscription?

Settings → Accounts → Claude → **An API key instead**. Create a key at
[console.anthropic.com](https://console.anthropic.com/settings/keys), paste it, and **Save**. You pay
Anthropic for what Job Hunt uses.
