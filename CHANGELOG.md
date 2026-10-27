# Changelog

All notable changes to Job Hunt. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
This file is generated from `static/changelog.json` by `python tools/release_ci.py sync`; edit that file instead.

## [1.45.0] - 2026-10-27

Company ratings from employee reviews.

### Changes

- What employees say about each company: the rating out of 5 and number of reviews from Glassdoor, Indeed and similar sites, work-life balance, the share who'd recommend it, and what reviewers praise and complain about. It shows as ★ 4.1 next to the company on the Overview, in your lists and on each job, with the details in a "What employees say" card on the job's Overview.
- Job Hunt looks companies up by itself for roles you're considering, a few at a time, once per company (again after two months), through Claude Code. On a job, Look up reviews or Look again asks now. Turn it off in Settings → Search → Employers.

## [1.44.0] - 2026-10-27

Settings that make sense, Drive sync you can see, and a fit forecast.

### Changes

- Settings are reorganised into six clear tabs: Accounts, Search, Job sources, Email & calendar, Sync & backup, and App. Each setting sits where you'd look for it: the daily search time with Search, your time zone and phone notices with Email & calendar, the browser button with Job sources.
- CV & career has three tabs: Your CVs, Career paths, and Your details (name, email, signature, stories and answers for application forms).
- The side menu is down to seven places: Overview, CV & career, Applications, Calendar, Inbox, Results and Settings. Documents is now a tab in Applications (next to Tracker, Board, All postings and Skipped), Add a job is the button at the top of Applications, and Recruiters is a tab in Inbox next to your job email. Old links still work.
- Fit forecast: next to each fit score, the score your CV could reach once it's tailored to that posting ("95 → ~97"), predicted from your real experience. Roles you've already tailored show the actual score instead.
- Sync & backup shows where your data is at a glance: last sync, last backup, and whether the last sync worked, with Sync now and Back up now. Choose how often it syncs, from every 5 minutes to once a day, or only when you press Sync now. The sidebar shows Syncing… or a red dot when a sync fails.
- When you sync with Google Drive, daily backups go there too: the last seven days, one per weekday.
- Fix: the Send to Job Hunt browser button did nothing on LinkedIn and some company sites. It now works on LinkedIn's job pages and search results, and Job Hunt reads the full posting from LinkedIn itself, with the company's own apply link. Add the button to your browser again to get the new one.
- Fix: after you change a tailored CV or cover letter in Word, its PDF is made again from your changes when you open or attach it.
- Fix: the time your Claude usage limit resets read differently in different places. It's now shown everywhere in this computer's time, with how long is left.
- Skipped roles whose fit forecast clears your minimum are marked "Worth a look tailored", so a near miss isn't lost.
- On a phone, the Postings and Skipped lists show the role, its fit and its stage (or why it was skipped) without scrolling sideways.
- Smaller fixes: cards with a button on the right no longer stack in the middle; the empty Recruiters card is gone from the Inbox; the setup page no longer says you use a subscription when you use an API key; Results says "Not enough replies yet" instead of a blank; Sync & backup has one Back up now button.

## [1.43.1] - 2026-10-21

View opens the posting.

### Changes

- Fix: View on a role you picked on the Overview opened its CV tab; it now opens the posting's Overview.

## [1.43.0] - 2026-10-21

Apply on the company's own site, and work-life balance in career paths.

### Changes

- When a role is on the company's own site, Apply goes there instead of LinkedIn, Indeed or another job board. Job Hunt picks up the company link from Google for Jobs and LinkedIn, and after you approve a role it asks Claude to find the posting on the company's careers site.
- On the Apply page, "Find it on the company's site" looks for it on demand; the job board posting stays as a fallback.
- Career paths now show the usual hours a week and the work-life balance of each role (good, mixed or demanding, and why: on-call, travel, busy seasons, remote), so you can weigh pay against time. Press Think again on CV & career to add them.

## [1.42.2] - 2026-10-21

CV & career up front, and senior roles searched too.

### Changes

- Fix: Indeed through your Claude account didn't work even when connected: Job Hunt started Claude Code with every tool switched off, which also hid your claude.ai connectors. It now refuses only the risky built-in tools by name.
- When Indeed (through your Claude account) doesn't work, Job Hunt now checks why and says so: Claude Code signed in with a token or API key, the connector not connected, or just not answering this time. Source tests say they try one sample title; real searches use all of them.
- Career paths help you choose a direction, not just your next job: each path shows where it leads now and in 3, 5 and 10 years, with the title and pay at each step, the top of the path and the most it can pay. A table compares the paths side by side, and Claude's advice weighs where they lead. Its job titles (to add to your search) are folded away under Look for this role now, with the CV they go to labelled.
- CV & career has its own place in the menu, second after Overview: your CVs, the experience Claude found, the job titles they search for, and your career options, all in one page. It used to be a tab inside Settings.
- Each job title is also searched as its senior version (Business Analyst and Senior Business Analyst), after the regular searches, so senior roles aren't crowded out of a page of results. Senior, Sr., Lead, Principal and II versions of a title all count as a match, as before.

## [1.42.1] - 2026-10-21

Neutral examples.

### Changes

- The built-in examples and sample data no longer resemble any one person: neutral roles, places and companies throughout.
- Setup guides suggest the server region and time zone nearest you instead of assuming one.

## [1.42.0] - 2026-10-21

Private by default, and Google in one button.

### Changes

- Phone notifications are private by default: they say only what kind of notice it is ("An interview update"), never the company, role or person, since they travel through a public relay. You can choose to include details in Extras.
- Connecting Google is simpler: with Job Hunt's connection built in it's one button with three plain steps; otherwise you choose the connection file whoever gave you Job Hunt sends you, then press the button.
- Clearer Google messages: if an unticked box left something out, Job Hunt says which; if Google refused, it says why (not added yet, or a work account) and what to do.
- A privacy page (PRIVACY.md) says where everything is kept: on your computer and, if you turn on sync, privately in your own Google Drive. Nothing goes to whoever shared the app.
- The app no longer carries a person's name as its publisher.

## [1.41.1] - 2026-10-21

Oakville finds the whole GTA.

### Changes

- Any city in a metro area now brings in the whole area, not just the main city: Oakville, Mississauga or Markham find the same GTA roles as Toronto (with "Include the area around each city" on, the default).
- With that setting off, a city is searched around itself (Oakville) instead of around Toronto, so its own postings aren't crowded out.
- Places match as whole words: Milton no longer lets in Hamilton.

## [1.41.0] - 2026-10-21

Every role your CV supports, and honest career advice.

### Changes

- When you add a CV, Claude now reads all of it and brainstorms 15–25 job titles across every field you've worked in (digital transformation, delivery, your speciality...), with the names different employers use, instead of a handful from your latest role. It also lists the areas of experience it found.
- Find more titles (on each CV) adds new ideas to the titles you have, without removing yours.
- Your career options: every direction your CVs support, each with its yearly pay range drawn to scale, pros and cons, what you'd need and a first step, and Claude's overall advice on the trade-offs. It's written by itself when you add a CV, shown under Settings → Your CVs and in Results, and one button adds a direction's titles to your search.
- Cities are picked, not typed: your country's popular cities (and areas like the GTA) are one click away, chosen places show as chips you can remove, and you can still type any other place.

## [1.40.0] - 2026-10-21

Easier for anyone, anywhere.

### Changes

- Search in any country, not just Canada: the Gulf and 60 other countries. Your country and time zone are picked from your computer, searches look across your country, LinkedIn's remote searches stay in it, and in a small country (Qatar, Bahrain, Singapore) a job anywhere in it counts as near you.
- A city brings in the area around it: Toronto finds roles across the GTA (Mississauga, Markham, Vaughan, Oakville…), and the same for Vancouver, Montreal, Ottawa, Calgary, New York, the Bay Area, London, Dubai, Sydney and Melbourne. Turn it off in Preferences.
- Only the sources that work in your country are offered (Job Bank for Canada, Adzuna where it searches, Canadian recruiters in Canada), job-alert emails from Bayt, Naukrigulf and GulfTalent are read, and pay in KWD, AED, £, € and others is understood, monthly too.
- Smoother everyday use: pages open at the top, "Approve and apply" is one name everywhere, the Overview sends you to check a CV and letter before approving, "Pick to tailor" says what it means, the job page has one Apply, Results waits for enough data, and tables fit on phones.
- Simpler Settings: Accounts (Claude and Google), Job sources, Your CVs, Preferences, Schedule, Extras and App. Every job source and extra is a tile saying what it does, whether it's free and whether it's working, with one button to turn it on or off; keys and fine-tuning are folded inside.
- Accounts shows only what needs attention, with the button that fixes it, instead of a long status list.
- Set up Claude without a terminal: one button installs Claude Code and signs you in through your browser, and Job Hunt notices when it's done.
- Claude's "session limit" and weekly limit are now recognised: Job Hunt waits until the time it resets, shows one calm notice, and no longer says Indeed or your email check is broken.
- The email check leaves mail that isn't about jobs alone (bills, smart-home alerts and the like), so it isn't sent to Claude, isn't shown, and doesn't use up your plan.
- New installs start with Windows, and take their country and time zone from the computer; time zones and hours are now picked from a list.
- Searching and adding a job ask for your CV first, and a posting you pasted is kept. Indeed through a Claude connector is off until you turn it on.
- Plainer words throughout ("set aside" instead of "filtered out", "Not checked yet" instead of a yellow "Not tested"), advanced settings folded away, and what to expect from Google's sign-in warning.
- On phones, Settings and job tabs wrap onto a second line instead of hiding off screen, and PC-only features aren't shown.
- A plain getting-started guide for friends, and a simpler README.

## [1.39.0] - 2026-10-21

A recruiters database, and an email to them when you apply.

### Changes

- Recruiters now have their own page (Recruiters in the menu): everyone who emailed you about a role, with their email, phone and LinkedIn from their email signature, and your notes. Edit any of them, add one yourself, search, or download a spreadsheet.
- When a recruiter emails about one of your applications, they're saved with it: the job page shows "Recruiter for this application" with their email, phone, how many emails and the latest subject, and they're added to the application's People list. Applications from before are linked from the emails Job Hunt already read.
- When you apply, Job Hunt writes to the recruiter on the application, or one you know at that company, or the person named in the posting. It says you've applied and, if they know you, asks them to put you forward. You choose on the Recruiters page: drafted in Gmail for you to send (the default), sent for you (optionally with your CV), or off. It never writes to the same person more than once a week, or to the address your application went to.
- Submitted an application in Job Hunt's Apply window? When the site confirms it ("Thank you for applying", "We've received your application"), Job Hunt marks it as applied by itself, lets you know, and writes to the recruiter as you chose. You can still mark it yourself at any time: I submitted it is always in the window, and Mark applied on the job.

## [1.38.1] - 2026-10-21

Recruiters you know (fixed build).

### Changes

- The recruiters update (1.38.0), now ready to install.

## [1.38.0] - 2026-10-21

Recruiters you know.

### Changes

- Job Hunt finds the recruiters you've dealt with in the last two years of your Gmail. These are the people who emailed you about interviews, screening calls or rejections, not automated emails. They're listed on the Inbox page, with their emails under one Gmail label (JobHunt/Recruiters). New ones are added as their emails arrive.
- Their companies' job boards are added to your search where Job Hunt can find them, and roles at those companies are marked "Recruiter: Jane".
- After you apply at one of their companies, Job Hunt reminds you to ask them to put you forward, and drafts the email in Gmail for you to send: "I applied for a role with you a while back; I've seen this one and I'm really interested. Could you put me forward?"

## [1.37.0] - 2026-10-21

Made for phones, and Cloudflare for the server.

### Changes

- On a phone, Job Hunt has a slim bar on top and tabs along the bottom (Overview, Applications, Calendar, Inbox, More), and pages start right away. Buttons are easier to tap, and fields don't make the phone zoom in.
- Add it to your phone's home screen and it opens like an app, full screen with its own icon.
- The Oracle Cloud guide now uses your own web address through Cloudflare: Cloudflare emails a one-time code before anyone sees Job Hunt, and nothing on the server is opened to the internet. A friend's copy gets its own address. Sign-in works properly behind it.

## [1.36.0] - 2026-10-21

For anyone, on any computer.

### Changes

- Google can be built into Job Hunt, so anyone you give it to just presses Connect Google and signs in with their own account, with no Google Cloud project of their own. Setting it up once is in SHARING.md.
- Google can now be connected on the server and from a phone: sign in, then paste back the address Google ends on.
- On a new computer, the Welcome page offers to continue from your data in Google Drive. A server that handed over to a PC can switch back with Use it here again.
- Fixed: continuing from synced data on the server was refused.

## [1.35.0] - 2026-10-21

Job Bank, recruiters and job sites, and switching connections off.

### Changes

- Job Bank (jobbank.gc.ca) as a search source, off until you turn it on: new postings for your titles in your places from the last 30 days, with full postings read for new ones. Requests are spaced 5 seconds apart.
- Recruiters and job sites, in Settings → Connections: Robert Half, Michael Page, Randstad, Adecco, Hays, Aerotek, Aplin, Altis, LRO Staffing, Lock Search Group, People First HR, Jobs.ca (also covers healthcarejobs.ca, techjobs.ca and itjobs.ca), Tech Talent Canada and CIPS. Tick the ones you want, or add any other site by its search address. Each one shows whether it's working; use Test them to check.
- Every connection can now be turned off on its own in the Status list; its keys and settings stay saved.

## [1.34.1] - 2026-10-21

No false alarm about job-alert emails.

### Changes

- Job-alert emails no longer show as "not working" just because none arrived this week. If Gmail can be read, they're working. Connections shows how many came, with a tip on setting up alerts if there were none.

## [1.34.0] - 2026-10-21

Sync straight to Google Drive.

### Changes

- Sync between computers can now go straight to your Google Drive through your Google connection, with no Google Drive app needed. Job Hunt keeps its copy in a "Job Hunt" folder in My Drive and can't see your other files. Choose it in Settings → App → Sync between computers.
- On a new computer, connect the same Google account and Job Hunt offers to continue from your data in Drive. It works on the NAS version too, so you can move between the NAS and a PC.
- Connected Google before this version? Reconnect it once to allow Drive, and turn on the Google Drive API in your Google project.

## [1.33.0] - 2026-10-21

Job Hunt fills in application forms.

### Changes

- On an application's Apply page, "Fill it in for me" opens the posting in a Job Hunt window. When the form appears, Job Hunt fills it in from your CV, cover letter and facts, answers the questions, and attaches your CV and letter as PDFs.
- It never presses Submit. Filled fields are outlined in green. Anything it couldn't answer, and boxes that agree to terms, are in amber for you. Check it over, submit, then press "I submitted it" to record it.
- Works on company application forms such as Greenhouse, Lever, Ashby, Workable and SmartRecruiters, including forms inside a company's careers page. Sites that need an account (Workday and the like): sign in, and it fills in what it can.

## [1.32.2] - 2026-10-21

Tap a posting's age on a phone.

### Changes

- On a phone, tap a posting's age to see the exact date and time it was posted.

## [1.32.1] - 2026-10-21

How old each posting is.

### Changes

- Postings show how old they are ("5 days old") in the Tracker lists, Postings, the Overview's pick list, Review and each job's page. Hover for the exact date and time it was posted, and when Job Hunt found it.
- Where the job site doesn't say when it was posted, it shows how long ago Job Hunt found it instead, in italics. Postings over a month old are in amber.

## [1.32.0] - 2026-10-21

Wake the PC for Job Hunt's tasks.

### Changes

- New in Settings → App: wake this PC from sleep to run Job Hunt's tasks: the daily search, the weekly review, prep the evening before an interview, and batches held for the night. It shows when the next wake is.
- Job Hunt needs to be open or in the tray, and Windows must allow wake timers (Power Options → Sleep → Allow wake timers). After its work the PC goes back to sleep as usual.

## [1.31.1] - 2026-10-20

Fixes from a full review.

### Changes

- Fixed the app freezing on mornings with an interview coming up (the morning summary).
- The page no longer refreshes over notes or answers you've typed but not saved, and a slow page can no longer replace the one you moved to.
- All-day Google Calendar events show on the right day. The thank-you note is retried when Claude was busy or at its limit, and a rescheduled interview gets its own evening-before reminder.
- The weekly review covers the right week when it runs late, and counts applications by your local date. Each company that replied is listed once.
- Held batches are kept if they hit the usage limit, and one per group is held. A budget-mode start time after midnight works.
- LinkedIn: remote-only results are no longer filtered out, searches stop once LinkedIn refuses, reading postings stops after two minutes, and postings it couldn't read wait for the next search instead of being scored from their title.
- Fewer false warnings: "posted again" needs a dated listing, one failed search of several no longer marks a source as broken, and "Interview prep didn't finish" isn't sent as urgent.
- Approve on the Calendar asks before emailing an employer, "Next round" books on the right application, and "Check first" shows on the Overview.
- Settings that run programs or change folders on your computer can't be changed from a phone.

## [1.31.0] - 2026-10-20

LinkedIn search, and Indeed status that agrees.

### Changes

- LinkedIn as a search source (off until you turn it on in Settings → Connections): new postings for your titles in your locations from the last week, through LinkedIn's public job search without signing in. Full descriptions are read only for postings that are new.
- Optionally through Apify instead: add an Apify token, and a LinkedIn jobs scraper runs once per search, for steadier results with full descriptions (paid per result after Apify's free credit).
- The Overview no longer says a source isn't working when a later Test in Connections showed it is. Both now go by whichever check is newest.

## [1.30.0] - 2026-10-20

What's working, career paths and smarter reminders.

### Changes

- Results now show replies and interviews by kind of role and by pay band, and what the roles you find pay. Scoring leans a little towards the kinds of role that get you replies.
- Career paths on the Results page: roles within reach now, a stretch and a change of direction, each with typical pay, what you'd need and a first step. One click adds their titles to your search.
- The evening before an interview, your prep sheet is ready and you get a reminder. About an hour and a half after it starts, a thank-you email is waiting in your Gmail drafts.
- Postings to check before you put time in are marked: posted again and again, 45+ days old, from an agency for an unnamed client, or collecting CVs for future openings.
- Claude usage in Settings → Connections: requests in the last 5 hours, today and this week, by task. Budget mode holds big batches for the night, and anything that hits your usage limit starts by itself once it resets.
- Phone notices for interviews, offers and employer replies ring through as high priority, with an option to get only those.
- A weekly review on Sunday evening (or Monday), emailed to you: what you sent against your goal, who replied, what's gone quiet, and the best new roles of the week.

## [1.29.0] - 2026-10-20

Two-way Google Calendar sync.

### Changes

- Job Hunt syncs with your Google Calendar every 30 minutes, or right away with Sync with Google on the Calendar page.
- Interviews you move or delete in Google Calendar move or disappear in Job Hunt too, with a note on the application.
- Interviews you added before connecting Google are copied into your Google Calendar.
- Your other Google Calendar events show greyed out on the Calendar page (you can hide them). An event that looks like an interview for one of your applications gets a Link to application button.
- Claude's notes now speak to you directly ("Your closest match is…"). Scores from before keep the old wording until you score them again.

## [1.28.0] - 2026-10-20

A more useful sidebar, and a tidier app.

### Changes

- The sidebar's footer shows what matters instead of "Stored on this computer": when Job Hunt last searched and when it searches next, when it last checked your email, sync or backup status, how many connections need attention (click to fix), and the version number (click for what's new).
- Overview: To do comes first. Once Claude and a CV are set up, the remaining optional steps are a single line under it instead of a big card at the top.
- A job's page has a shorter action bar (Approve, Mark applied, Open posting, Save for later, Not interested); the CV, letter, PDF and Show files buttons moved to the top of its CV & letter tab.
- Sources read as names everywhere (Google for Jobs, Adzuna, Greenhouse, LinkedIn…) instead of internal ids.
- Phone: To do rows keep titles readable, with the buttons below them. Fixes: Review them one by one was in capitals; the Board said "Nothing in Approved – submit it".

## [1.27.0] - 2026-10-20

Every connection, its status, and its fix.

### Changes

- Settings → Connections opens with a Status list: Claude, Gmail and Calendar, Google for Jobs, Jooble, Adzuna, Indeed, company job boards, job-alert emails, phone notifications, sync and backups, each Working, Problem, Off, Not set up or Not tested, with the last error and when it was checked.
- Each one has its own buttons: Test (just that source, without running them all), the fix (Connect, Check again, Remove broken boards, Back up now, Sync now, Open Claude connectors for Indeed) and Turn off or on where it makes sense. Find a connection with the search box.
- Fixed: the warning about failed sources now opens the Status list, where Indeed and the rest can be tested and fixed one by one.

## [1.26.0] - 2026-10-20

Your words, your files.

### Changes

- Edit the tailored CV yourself: under What changed in your CV, each reworded paragraph has Edit (write it your way) and Put back (the line from your own CV). Your edits are kept as you write them, and Undo works as before. Also in Review mode.
- Attach your own CV or cover letter for a role (Word or PDF) on its CV & letter tab. Job Hunt uses it in the Apply screen and in emailed applications, keeps its own version, and Use Job Hunt's CV switches back. Claude leaves your own files alone.

## [1.25.0] - 2026-10-20

Smoother from review to applied.

### Changes

- Review mode: go through ready applications one at a time on one screen: why it fits, fit before and after, what changed in your CV, the letter, and Approve, Save for later, Not interested or Skip (keys A, S, X, N). Start it from the Overview's To do.
- Apply screen: approving opens one page with the posting, your CV and letter (PDF or Word), your details and form answers to copy, and an I've submitted it button. Approved applications have an Apply button everywhere.
- A confirmation email ("we received your application") now marks an application applied even if you hadn't approved it in Job Hunt.
- Picking roles to tailor: grouped by the CV they'd use, with why each fits and any red flags right in the list, and Tick the top 5.
- Applications quiet for 4+ weeks (no reply, follow-up sent) show on the Overview with Close as No response, a new stage that keeps the Tracker to what's still live.
- Keep this PC awake while Job Hunt works (Settings → App, on by default): Windows won't sleep while it searches, tailors, checks email or backs up.
- A morning summary each day after the search: interviews today and tomorrow, applications to review, roles to pick, follow-ups due and postings about to close. With Remote access on, tapping a phone notice opens Job Hunt.
- First-time setup: a guided page (Claude, CVs, locations, sources, first search) that opens by itself on a new install.
- The Overview shows what needs you today; the pipeline and weekly charts moved to Results. Applications drops the All tab. Problems in Needs attention have a button that fixes them (Search now, Try again, Back up now, Sync now).

## [1.24.0] - 2026-10-20

Calendar, and choosing folders.

### Changes

- New Calendar page: a month view and the next 30 days of interviews, prep time, thank-you and follow-up reminders, application deadlines and follow-ups that are due, each with its next step (Prep, Write follow-up, Tailor, Approve). After an interview it asks how it went: Next round, Offer or Rejected.
- Add an interview yourself (Calendar → Add interview): Job Hunt adds prep time and reminders around it, in your Google Calendar too when it's connected, and moves the application to Interviewing. Without Google, Job Hunt keeps them itself.
- Download for Outlook / Apple: the next 90 days as a calendar file to import.
- Settings → App → Sync between computers: Browse… opens Windows' folder picker instead of typing the path.

## [1.23.0] - 2026-10-20

Duplicates by link, pay insights, letter styles.

### Changes

- The same posting found through two sources is shown once even when the title or company name differs: Job Hunt also matches postings by their link (ignoring tracking tags, language parts and the like). Copies already in your lists are merged.
- Results shows the pay in the roles you tailored: the lowest, typical and highest yearly salary, how many top out below your minimum, and the best-paid roles.
- Pick a cover-letter style for each CV in Settings → Your CVs: Standard, Formal (banks, government, law), Short and direct (startups, tech) or Warm and personal.

## [1.22.0] - 2026-10-20

Tailor anything, score again, tidier Settings.

### Changes

- Tailor anyway: pick any posting (skipped, scored low, outside your locations, not interested or saved) and Job Hunt tailors your CV and a letter for it. It's scored first if it never was, and the filters leave it alone from then on.
- Score again: score skipped postings again against your CVs and settings as they are now (Applications → Skipped, or Settings → What to search for). It says how many Claude requests it will take before it starts.
- Remove postings you never acted on after 30, 60 or 90 days (Settings → What to search for). Only skipped, not-interested and closed ones; removed postings aren't found again as new.
- Posting dates read like the rest, e.g. Oct 13, instead of 2026-10-13T00:00:00.000Z.
- Documents has quick filters: Ready to approve, Applied, Interviewing, This week, Saved for later, Rejected or closed.
- The Overview's setup card no longer stays up for Gmail or a job-search service if you don't want them: click Not now. The sidebar stops saying Google isn't connected too.
- Settings: What to search for is grouped into Where, Which roles, Scoring and tailoring, and Older postings; Connections shows the API key only when you use one and puts rarely needed options under Advanced; What's new shows the latest versions with the rest folded away; checkboxes line up with their labels.
- Fixed: the Overview's setup steps had lost their layout in 1.21.0.

## [1.21.0] - 2026-10-15

A tracker for your applications.

### Changes

- Applications opens on a new Tracker: every application with the steps it has reached (found, tailored, applied, reply, interview, offer) and when, how long since the last one, and what's next. It shows whether it's your move or theirs, with the button for your next step right there.
- Filter the Tracker by In progress, Waiting on you, Waiting on them, No reply in 2+ weeks, Interviewing, Saved for later or Finished. Each job's page has the same progress with dates.

## [1.20.0] - 2026-10-15

Reads like you wrote it.

### Changes

- Tailored CVs, cover letters, follow-ups, form answers and messages no longer have em dashes or the usual AI words (spearheaded, utilized, seamless and the like): Claude is told not to use them, and Job Hunt fixes any that slip through. If your own CV uses them, they stay.
- Hidden characters that AI screening tools can spot (zero-width spaces, soft hyphens, direction marks, unusual spaces) are removed from everything Job Hunt writes.
- Nothing in the Word files names Job Hunt: the signature picture has a plain name, and the files keep your own CV's properties.

## [1.19.0] - 2026-10-15

You choose what to tailor, and only roles near you.

### Changes

- After a search, roles that clear your fit score wait on the Overview: tick the ones to tailor your CV for. Job Hunt picks which of your CVs to start from. To tailor everything automatically, turn on Tailor automatically in Settings → What to search for.
- Each tailored application shows its fit score before and after tailoring.
- Only roles in your locations are shown. A remote role counts only if it's based there or open across Canada; postings that don't say where they are are left out.
- The same role found twice (another source, or the company's name spelled differently) is shown once, and existing copies are merged.
- Not interested now asks in Job Hunt's own window, and lets you skip without teaching Job Hunt, or Save for later to keep the role as a backup.
- Tailoring is quicker: PDF copies are made when you open them, the fit re-check runs after the application is ready, and up to 3 picked roles are tailored at once.
- Settings → Connections: choose the model (Opus or Sonnet) and effort for tailoring. The default is Opus at medium.
- Test sources says it tries one job title per service; real searches use the others too.

## [1.18.0] - 2026-10-15

Toronto and the GTA, and removed boards stay removed.

### Changes

- Fixed: company boards you removed came back. Settings left open no longer write old board lists back, and finding employers by itself won't re-add a board you took out.
- Locations is now the only place list: Job Hunt searches those places and keeps jobs located in them. The separate “search in” list is gone, and Country sits next to Locations.
- Writing GTA (or Greater Toronto Area) takes in Mississauga, Brampton, Markham, Vaughan, Richmond Hill, Oakville, Burlington, Pickering, Ajax, Whitby, Oshawa and Toronto's districts.
- Google for Jobs, Jooble and Adzuna search about 50 km around each place, so a Toronto search reaches the suburbs, and they search every place you list, not just the first.
- The Last search card shows how many postings each source gave (company boards, Google for Jobs, Jooble, Adzuna, Indeed) and which ones failed.

## [1.17.0] - 2026-10-15

Easier to use, and more job listings.

### Changes

- A job's page is split into tabs (Overview, CV & letter, Apply, Interview, Notes & history) and opens on what that stage needs.
- The Overview has one To do list, with Approve, Mark applied and Write follow-up right on each row; Applications > All has the same buttons.
- Settings save by themselves as you type.
- Undo after moving an application to another stage, for a few seconds.
- The board shows only stages with applications in them; offers and rejections are folded into a Finished section.
- Keyboard: / to search a list, a to approve, j and k to go to the next or previous job, Esc to go back, ? for help.
- Clearer text in both themes, a placeholder instead of an empty weekly chart, and step-by-step percentages on the Results funnel.
- More job listings: Google for Jobs through JSearch (postings from LinkedIn, Indeed, Glassdoor, ZipRecruiter and company sites; free for 200 searches a month) and Jooble (free key), alongside Adzuna, in Settings > Connections.

## [1.16.1] - 2026-10-15

A nicer theme switch and layout fixes.

### Changes

- The theme button is now a switch with Auto (matches Windows), Light and Dark, showing which is on.
- On a phone or a narrow window, pages no longer run off the side; wide lists and tabs scroll on their own.
- The Overview shows Finish setting up first while setup isn't done, and a job's page shows its fit, stage and notes before application questions and contacts.
- Board columns fit more on screen, long stage names no longer overlap their counts, and board cards show salaries compactly.
- Recent activity says Backup saved instead of a file path.

## [1.16.0] - 2026-10-15

Employers near you, found automatically.

### Changes

- Job Hunt now finds employers in your locations by itself: every week, soon after you change your locations or job titles, and whenever a search finds little that's new. Claude suggests employers with offices there, Job Hunt checks each one's job board, adds those with roles matching your CVs, searches them, and tells you who it added.
- Company boards that no longer exist are removed by themselves after two searches in a row can't find them.
- Turn this off in Settings > What to search for > Company job boards if you'd rather choose every company yourself.

## [1.15.0] - 2026-10-15

One-click fixes for sources, and help getting more postings.

### Changes

- Company boards that no longer exist are flagged on the Overview with Remove them and Suggest companies buttons, and Test sources has a Remove button on each broken board.
- Suggest companies now adds the employers you tick straight away and starts a search of them, from the Overview, Test sources or Settings.
- Last search says how many postings were already seen before and why new ones were filtered out (location, title, salary). When a search brings few new postings, it offers the quickest ways to get more.

## [1.14.1] - 2026-10-15

Tidier, sortable application lists.

### Changes

- Applications > All, Postings and Skipped: click any column heading to sort by it (again to reverse). Job Hunt remembers your choice.
- The role gets the room it needs, and long salary text from some job boards ("• Offers Equity • Multiple Ranges") is shown compactly under the pay range. Sorting by salary uses the top of the range.

## [1.14.0] - 2026-10-15

Application questions, deadlines, mock interviews and offers.

### Changes

- Application questions: paste a form's questions on a job's page (or leave it empty for the usual ones) and Claude drafts answers from your CV, the posting and your facts for forms (Settings > Your CVs), ready to copy.
- Deadlines: when a posting says when applications close, Job Hunt shows it, lists what's closing soon on the Overview, and reminds you two days before.
- Mock interviews in the Claude app: ask "Practise my interview for <company>" and Claude plays the interviewer, with feedback on each answer.
- ATS check: each tailored CV and each of your CVs is checked for what applicant tracking systems misread, such as text boxes, contact details in the header, columns or missing section names.
- Needs attention: the Overview flags anything that stops Job Hunt working, like a failing source, Google disconnected, no recent search, sync or backups falling behind.
- A weekly goal on the Overview and a Monday summary of your week, on your phone too.
- Offers: paste an offer and get how it compares, what to ask for and a counter-offer email.
- People at each company: keep the recruiter or hiring manager on the job's page and have Claude write them a short message.
- Results: Claude reads your results and says what's working and what to change, on request and once a month.

## [1.13.0] - 2026-10-15

Send to Job Hunt, Claude Desktop and phone notifications.

### Changes

- Send to Job Hunt: a button for your browser's bookmarks bar (Settings > Integrations). On any job posting, including LinkedIn, click it and Job Hunt adds the posting, scores it and tailors your CV and cover letter.
- Use Job Hunt from the Claude desktop app: ask what's waiting for approval, have a letter changed, a follow-up written, a job added or a search run, in plain words. One click in Settings > Integrations sets it up.
- Interview prep sheets now include what the company is up to, from a quick web search, with links.
- Phone notifications through the free ntfy app: applications ready, interviews booked, offers and follow-ups, wherever you are.
- Job-alert emails from Canada's Job Bank, Eluta and Workopolis are read too, alongside LinkedIn, Indeed and Glassdoor.
- Your applications as a spreadsheet: Export on the Applications page, and with sync on, an up-to-date copy in your Google Drive folder to open in Google Sheets.

## [1.12.0] - 2026-10-15

More job boards, follow-ups, revisions and results.

### Changes

- Test sources (Settings > What to search for) tries every company board, Adzuna, Indeed and your job-alert emails once, and shows what each one finds or why it finds nothing.
- Company job boards on Workday (most banks and large employers), SmartRecruiters and Workable, alongside Greenhouse, Lever and Ashby. Suggest companies proposes them too.
- Closed postings are noticed: once a day, and before tailoring, Job Hunt checks postings waiting on you and marks the ones taken down or no longer accepting applications as Closed.
- Follow-ups: when an application has had no reply for 8 days (you can change this), Job Hunt drafts a short follow-up in your Gmail for you to check and send. They're listed on the Overview too.
- Ask for changes on a job's page: type what you want, like "make it shorter" or "lead with the ERP rollout", and Claude changes the tailored CV or cover letter. The last change can be undone.
- A Results page shows how many applications get replies and interviews, by CV, by source and by fit score.
- If Job Hunt is open on another computer, the Overview says so and offers to take over: the other computer saves its latest data and stops, and this one continues from it.

## [1.11.0] - 2026-10-15

Salary in the Applications lists.

### Changes

- Applications > All, Postings and Skipped have a Salary column, and board cards show the salary when the posting gives one.
- Salaries are also read from the posting text ("$110,000 – $135,000 per year", "CA$95K–120K", hourly rates) when the job site has no salary field, which fills it in for many more postings, including ones already found. Your minimum salary filter uses them too.

## [1.10.0] - 2026-10-15

Pick up where you left off on any computer.

### Changes

- Sync between computers (Settings > App): Job Hunt keeps an up-to-date copy of everything in a Google Drive folder, every few minutes after a change and when it exits.
- On another computer, install Google Drive for desktop and Job Hunt: it finds your data in Google Drive and offers to continue from it, sign-ins included. When one computer has newer data than another, the Overview offers to continue from it, and nothing newer is ever overwritten.
- Daily backups now go to the same Google Drive folder.

## [1.9.0] - 2026-10-15

Backups, phone access and a Synology version.

### Changes

- Backups: every day Job Hunt saves one zip with everything (applications, CVs, cover letters, settings, signature) and keeps the last 14. Choose your OneDrive or Google Drive folder in Settings > App so they're copied to the cloud. Back up now and Restore from a backup are there too.
- Remote access (Settings > App): use Job Hunt from your phone's browser while it runs on this PC, behind a password. With Tailscale (free) it's reachable only by your own devices, from anywhere.
- A Synology / Docker version: Job Hunt can run on your NAS all day, free and private, so your PC can be off. Restore your PC's backup there to move everything over. See server/README.md for the steps.
- From a browser, files download and links open in a new tab.

## [1.8.0] - 2026-10-15

One version number everywhere.

### Changes

- Versions now read the same everywhere, in three parts: the app, What's new, update notices, the GitHub releases and the installer are all 1.8.0. Earlier versions are listed the same way (1.07 is now 1.7.0).

## [1.7.0] - 2026-10-14

Read postings right in the list.

### Changes

- Click any row in Applications > All, Postings or Skipped to read the posting right there, with why it was skipped or its fit, and buttons to open it on the site or see full details.
- Score it anyway: a skipped posting can be scored on request, and if it clears your fit bar it's tailored like any other.
- Postings located "Remote - Canada" and similar now count as remote, so they're no longer filtered out as outside your locations.

## [1.6.0] - 2026-10-14

Search progress, every posting, LinkedIn alerts and interview prep.

### Changes

- A progress bar on the Overview while a search runs: which stage it's on, how far along, and how many postings it has found, scored and tailored. The sidebar shows the percentage too.
- After a search, the Overview sums it up, with any problems, and Applications > Postings lists every posting ever found with its source, fit and a link to the posting.
- Job-alert emails from LinkedIn, Indeed and Glassdoor are read on each email check, and their postings scored like any other. Set up alerts on those sites and connect Gmail.
- Titles a word match misses get a second look: Claude checks them in one quick batch, so roles like "Transformation Lead, Finance Systems" aren't lost.
- Suggest companies (What to search for > Company job boards): Claude proposes employers near you, and only boards that really exist and have jobs are offered.
- PDF copies of every tailored CV and cover letter, made with Word (or LibreOffice). Open them from the job page or Documents.
- Your stories (Settings > Your CVs): true achievements that aren't in your CV, for cover letters to draw on.
- Not interested asks why, and the scorer learns from your recent decisions.
- Interview prep: when a job moves to Interviewing, Job Hunt writes likely questions with answers from your CV, gaps to prepare for and questions to ask. Also saved with the application's files.
- Fixes: duplicate postings in one search are scored once; tabs on the Applications page look right again.

## [1.5.0] - 2026-10-14

Fewer good jobs filtered out, and Force search.

### Changes

- Job titles match more loosely: "Senior Program Manager" now also matches "Sr. Program Manager, Payments" and "Program Manager II". Every key word still has to appear, so "Program Manager" doesn't match "Product Manager".
- Force search, on the Overview and on Applications > Skipped, searches and also re-checks postings filtered out earlier, using your current CVs and settings.
- Applications > Skipped shows why postings were skipped (title, location, salary, fit score), with links to the settings that control it.

## [1.4.0] - 2026-10-14

Indeed search and a Documents page.

### Changes

- Searches Indeed for your CVs' job titles through the Indeed connector on your Claude account. Needs Claude Code on this PC and Indeed connected at claude.ai → Settings → Connectors. Turn it off in What to search for.
- New Documents page: every tailored CV and cover letter, newest first, with buttons to open them or show the files.
- Each job's page previews the whole tailored CV, with reworded paragraphs highlighted, and the cover letter as it prints, signature included.

## [1.3.0] - 2026-10-14

Stronger cover letters with your signature.

### Changes

- Cover letters follow a proven layout: date, ATTN line and a bold Subject with the job's reference number, an opening that quotes the posting's key requirement, 3-4 bold-labelled achievements from your CV with their real figures, and a short close.
- If a posting asks for a degree or certification your CV doesn't show, the letter says so honestly and offers your experience instead. It never claims it.
- Add your signature in Settings > Your CVs. It goes between the sign-off and your name on every new cover letter.
- Emailed applications drop the bold markers so the message reads cleanly.

## [1.2.0] - 2026-10-14

Your settings and API key are back.

### Changes

- If you used Job Hunt 1.00, your locations, Adzuna search area and company job boards are filled back in. Anything you've set since is kept.
- A Claude API key you saved before 1.01 is used again, unless you picked Claude Code on this PC.
- The minimum salary field now says what to enter: a yearly amount in digits, like 120000.

## [1.1.0] - 2026-10-14

Claude Code, any CVs and automatic updates.

### Changes

- Uses Claude Code on this PC and your Claude subscription by default, so no API key or credits are needed. An API key is still an option.
- Add as many CVs as you like, in Word, PDF or text. Claude names each one and suggests the titles and keywords to search for.
- PDF and text CVs, and Word layouts that can't be edited, are converted word for word into a clean, editable Word copy.
- Reads more CV layouts: headings in any style, typed bullets and table layouts.
- Tell the scorer what matters to you, choose the Adzuna country, and cap how many new postings each search scores.
- Job Hunt checks for updates, tells you when one is ready, and installs it in a few seconds without touching your data.

## [1.0.0] - 2026-10-14

Job Hunt for Windows.

### Changes

- Its own window and tray icon, notifications and start at sign-in.
- Overview, applications board, job review with CV changes before and after, inbox and settings.

[1.45.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.45.0
[1.44.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.44.0
[1.43.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.43.1
[1.43.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.43.0
[1.42.2]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.42.2
[1.42.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.42.1
[1.42.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.42.0
[1.41.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.41.1
[1.41.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.41.0
[1.40.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.40.0
[1.39.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.39.0
[1.38.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.38.1
[1.38.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.38.0
[1.37.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.37.0
[1.36.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.36.0
[1.35.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.35.0
[1.34.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.34.1
[1.34.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.34.0
[1.33.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.33.0
[1.32.2]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.32.2
[1.32.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.32.1
[1.32.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.32.0
[1.31.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.31.1
[1.31.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.31.0
[1.30.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.30.0
[1.29.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.29.0
[1.28.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.28.0
[1.27.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.27.0
[1.26.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.26.0
[1.25.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.25.0
[1.24.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.24.0
[1.23.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.23.0
[1.22.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.22.0
[1.21.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.21.0
[1.20.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.20.0
[1.19.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.19.0
[1.18.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.18.0
[1.17.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.17.0
[1.16.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.16.1
[1.16.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.16.0
[1.15.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.15.0
[1.14.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.14.1
[1.14.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.14.0
[1.13.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.13.0
[1.12.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.12.0
[1.11.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.11.0
[1.10.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.10.0
[1.9.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.9.0
[1.8.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.8.0
[1.7.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.7.0
[1.6.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.6.0
[1.5.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.5.0
[1.4.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.4.0
[1.3.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.3.0
[1.2.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.2.0
[1.1.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.1.0
[1.0.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v1.0.0
