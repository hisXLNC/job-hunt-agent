# What changed

The newest version is first. The release build publishes the top section as the release's notes.

## 26.11.32

- **No more Next button.** Today, Roles, Radar, Replies, People and an employer's roles are each one list: the whole page scrolls, and the filters and the sort header row stay at the top while it does. More rows come in by themselves as you near the end. Sorting and filters work across everything.
- **Employer logos**: a logo is only taken from a site that carries the employer's name, so a job site's or Telegram's icon no longer stands in for an employer. Employers with no known site have their own address tried (for example cibc.com), and used only when the page there names them. Logos are looked up again once after this update.
- **The "⋯" menu opens upward** when the row is near the bottom of the window, and closes when you click elsewhere.
- The "Posted" filter on Today is no longer cut off, and "While you were away" no longer says the first search hasn't run when there are roles in the list.
- **Your own fit bars** (You → Profile): the fit from which a role is kept, the fit from which Job Hunt prepares the CV and letter by itself, and how many it prepares per search. Also "what matters to you in a job", which Claude reads with every role.
- **Interview hours** (You → Connections → Your calendar): the hours and length you can do, and how many times to offer. Replies to interview invitations come with those free times filled in, and an interview time and link in an e-mail is put on your Interviews page by itself.

## 26.11.31

More back from the old app (second batch):

- **Pay is read from the posting's own text.** Most sources give no pay field, so the pay floor used to miss most postings. Now "Salary range: $85,000 - $105,000 per year" or "$42.50/hour" in the text counts, for new postings and for the ones already here. It only fills an empty pay, and leaves it empty when it is not sure.
- **The role page**: your own **notes** on a role; **edit the wording** of any tailored change yourself; **questions on the application form** (paste them, get answers to copy); and **Not for me** now asks why, which the reading of later roles takes into account, with "Never show this employer" in the same list.
- **The side panel attaches PDFs** (what most forms want) and offers Word as well. It keeps to Word by itself when a PDF could not show every letter. Reload the side panel once after this update.
- **Four weeks without a reply**: Today offers to close the application as "no reply" or keep waiting a week. It opens again by itself if they write.
- **Pause searching for a day, three days, a week or two**; it starts again by itself.
- What Claude writes is cleaned before it is kept: no hidden characters and no long dashes.

## 26.11.30

Back from the old app (first batch; the full list is kept in `design/parity.md`):

- **A "we received your application" e-mail marks the role as applied**, even if you never pressed "I applied". If Job Hunt never found that role, it is added as applied so it is counted and followed up. A role you marked not interested is never brought back this way.
- **Archived mail is read too** (Gmail's All Mail), so a confirmation you archived is not missed. Your own sent mail is skipped. You can set how often the inbox is checked (You → Connections → Your inbox).
- **Reminders**: the evening before an interview (with the prep pack ready), "How did it go?" about an hour and a half after one, two days before a posting closes, and a **morning summary** of what needs you (on Mondays with last week's numbers). Choose the hour, or turn it off, under You → Connections → On this computer.
- **After an interview**: say how it went (another round, an offer, waiting, a no) and the role moves with it; a **thank-you** is drafted for you to copy or open in your mail.
- **Phone notices are private by default**: they say what kind of thing happened, not the role or employer, because they pass through the ntfy server. Tick "Name the role and the employer" to get the old wording back. New: "Only interviews and offers", and interviews and offers are sent as urgent. Reminders and replies now reach the phone too.
- **Start with Windows** is a switch in Job Hunt (You → Connections → On this computer, and the icon by the clock), not only in the installer. The icon's menu also has **Check my inbox now**.

## 26.11.29

- **Job Hunt has its own window again**, like the old app. It is no longer a browser window, so there is no address bar and none of the browser's extensions or their banners ("... is debugging this browser" came from an extension in your browser). It opens **where you left it, at the size you left it**, maximised if it was. Postings and other outside links open in your normal browser, where the side panel is.
- Starting Job Hunt while it is running brings its window forward. A click on a notification opens that page in Job Hunt's window.
- **An update never cuts a search short.** It waits until the search, the reading and the writing in hand have finished, starts nothing new meanwhile, then installs. "Install now" during a search says so and does the same. The window comes back by itself afterwards.
- **A search that was cut short is picked up at the next start** (the computer shut down, Job Hunt was stopped), so nothing it had not reached yet is missed.

## 26.11.28

- **Job Hunt on your phone.** Under You → Connections, turn on "Let my phone connect", press "Add a phone" and point the phone's camera at the code. The phone's browser then shows Today, a role with its fit and your letter, the CV and letter as PDF, replies and interviews, and you can mark a role applied, not for you or saved for later. Nothing is installed on the phone. It works on your own Wi-Fi while this computer is on; with Tailscale on both it works from anywhere. A phone can't reach keys, passwords, settings or saved copies.
- **Your Google Calendar.** Paste your calendar's secret address (the steps are on the card) and Job Hunt reads it, read-only: your own entries show on the month under Interviews, an interview that lands on one is flagged, and the times you are free are listed ready to copy into a reply. What it reads stays on this computer and is never given to Claude. Outlook and iCloud addresses work too. Each interview has an **Add to Google Calendar** button.
- **Your data in Google Drive or OneDrive.** Under You → The app → Saved copies, "Keep copies in Google Drive" (or OneDrive, Dropbox) puts the saved copies in that drive's folder, refreshed every three hours, so they are off this computer and can be restored on another one.
- **Phone notices explained step by step**, with what to do when the test doesn't arrive. With phone access on, a notice opens the role in Job Hunt on the phone.
- **The side panel fills far more forms**: Workday (step by step, with work history, education and skills), Greenhouse, Lever, Ashby, Workable, SmartRecruiters, SuccessFactors, iCIMS and Zoho Recruit, and ordinary forms with custom dropdowns and tick boxes. It says what it filled, what it left for you and what needs a check. It never presses Submit or Next.
- Side panel: Alt+Shift+F fills the form; right-click a field for "Job Hunt: fill this in"; after you send an application it offers to mark the role applied; answers you typed are offered as "Remember this answer?" (never passwords, ID or bank details); expected salary is filled from the role's pay or your floor and marked for a check; "Copy the panel's log" for reporting a problem.

## 26.11.27

Second batch from going through everything the old Job Hunt did.

- **PDF**: your CV and letter download as PDF as well as Word, or both in one PDF (letter first) for forms that take a single file. Files are named "Your Name - Employer - CV.pdf". PDF covers Western European letters; for other scripts use Word.
- **Letter styles**: Standard, Formal, Short or Warm. Your usual one is set under You and can be changed for any one role, with your own closing line.
- **Ask for changes** under the letter and the tailored CV: say what you want different and it is written again. "Put it back" restores the one before.
- **Follow up**: when an application has had no reply after 8 days (your choice under You; 0 turns it off), Today suggests one short follow-up. Job Hunt writes it; you send it. One per application.
- **Save for later** on a role (tomorrow, in 3 days, next week). It leaves Today and comes back by itself.
- **Undo**: "I applied" and "Not for me" show Undo for ten seconds, and "I didn't send it" puts an applied role back.
- **A weekly goal** (10 applications unless you change it): Today shows "4 of 10" and Progress shows the last eight weeks against it.
- **Clear taken-down roles** under Roles → Ended closes roles whose posting is gone, or that no search has seen for 30 days, and that you never prepared or applied to. Nothing is deleted.
- **More job sources**: Adzuna, Jooble and Google for Jobs (through JSearch), each with your own free key, under You → Connections. Job-alert e-mails from job sites in your inbox are read for postings too. Radar shows what every source found.
- **Dark theme** (light, dark, or follow Windows) under You → The app.
- **The bell** keeps what happened while you were away.
- **A month calendar** on Interviews, and a calendar file other calendars can read.
- **Put back a saved copy**: Job Hunt keeps dated copies of your data and can restore one, under You → The app.
- **Best 10 and Top 5** on Today; **Find a setting** on You; hovering over "3 h ago" shows the exact time.
- Pages re-fit themselves when the Claude panel opens or the window changes size.

## 26.11.26

First batch from going through everything the old Job Hunt did.

- **Windows notifications**: a fresh role that fits (with its fit, age and applicant count) and "X wrote to you". A click opens it in Job Hunt. Switch and "Show a test" under You → Connections → On this computer.
- **An icon by the clock**: its menu opens Job Hunt, searches now, checks for updates or stops it.
- **Keeps the computer awake** while it is working (or always, or never: your choice). A sleeping computer finds nothing.
- **You set when it searches**: the times of the full searches, how often the quick check for brand-new postings runs (10 minutes to 2 hours, or off) and between which hours. You → Connections → When Job Hunt searches.
- **Hard limits** under You: postings older than a number of days, roles that pay under your floor, and contract, part-time or internship roles can be set aside without being read. Until now the pay floor only put a tag on the role.
- **Keyboard**: j and k move through a list, Enter opens, x ticks, p prepares, a marks applied, n is "not for me", o opens the posting, c asks Claude, / goes to the find box, ? lists the keys.
- **Save as a spreadsheet** on Roles: every role as a file Excel opens.
- **What changed in each version** is listed under You → The app. Job Hunt now looks for a newer version every half hour.

## 26.11.25

- **Job Hunt updates itself.** It looks for a newer version every few hours. When there is one it downloads the installer, checks it is exactly the file that was published, installs it quietly while it isn't in the middle of something, and comes back by itself on the new version. Your data, your desktop shortcut and your "start with Windows" choice are left as they are.
- **"Install now"** in the bottom left and under You → The app, for when you don't want to wait. "Check for a newer version" looks at once.
- **A switch, "Install new versions by themselves"**, under You → The app. Turn it off and Job Hunt only tells you.
- **"What's new"**: after an update Job Hunt shows once what changed since the version you were on.
- This one version still has to be installed by hand. Every later one installs itself.

## 26.11.24

- **Every employer has its own page.** Its postings (part of the company, where, type, pay, fit, posted, applicants, where each stands) with filters and sorting, your history there, the people you know there, what it does, what working there is like (Claude reads public employee reviews when you press "Look it up"), what happened lately, and your own notes.
- **Employer names are links everywhere**: Today, Radar, Roles, a role's page, People, Replies, Interviews and the find box all open the employer's page.
- **Real employer pictures.** Job Hunt takes each employer's icon from the employer's own website (never from an outside service) and keeps it; the coloured letters stay where a site has none.
- **The window can be any size.** Lists show as many rows as fit the window and page for the rest. In a narrow window the menu folds to icons and the less important columns step aside; in a wide one the columns spread instead of one column taking everything. Pay is written short ("$110k–$150k") so it is no longer cut off.
- **Tick several roles and act once**: Prepare, I applied or Not for me, on Today and on Roles.
- **Fit rings use the old colours again**: green from 80, amber from 60, red below.
- **"You" is called You again**, and keeps the Browser side panel tab.
- **Roles that showed with no score.** When a posting's text couldn't be fetched, the role was shown unscored and never tried again. Job Hunt now reads the posting's own page as a second way, tries again on the next passes, and keeps unscored roles out of "Fresh now".

## 26.11.23

- Today is one compact list, as in the design you saw: every thing to do is a row, about a dozen fit on a screen. Each role shows remote, hybrid or on site, full-time, part-time or contract (read from the posting), pay, both fit scores, how long ago it was posted and how many have applied.
- A "Worth knowing" column says what would change your mind: "Applied here once" (or twice), "Posted 3 times", "Closes Fri 4 Dec", "Under your pay floor", "Part-time", "Open 45 days", "A step up", "Through a recruiter", and the one requirement your CV does not cover.
- Sort by clicking a column heading (to do, employer, pay, fit, posted, applicants); filter by kind, where, type, pay, fit and how recently it was posted. Twenty to a page.
- Each row has one main button; everything else (I applied, Not for me, Read what's sent, and so on) is under ⋯. An employer's name opens everything from that employer.
- The question Job Hunt needs answered is now one slim strip instead of a tall box.

## 26.11.22

- One place says what Job Hunt is doing: the panel at the bottom left. It shows each thing in progress with its bar and a Stop button, when the next check is, and the version you are running. The second status at the top is gone. After you stop something it says so, says when Job Hunt will start by itself again, and has "Carry on now".
- Versions are dated again, like the old Job Hunt's: year.month.count. This is 26.11.22; it follows the old app's 26.11.21 and the three first releases of the rewrite (3.0.0 to 3.0.2). The program, the installer, Windows' list of apps, the side panel and GitHub all show the same number.
- "You" is now called Settings, with a gear. It has a page of its own for the browser side panel: a Download button, the folder it is already in on this computer with "Open the folder", and the five steps to put it in Chrome or Edge.
- Debugging for everything: Job Hunt writes down each search and page it fetches, each call to Claude, each background job, each request and each error (in the program and in its pages) in debug.log in your data folder. Settings → The app and debugging shows the newest lines and has "Copy debug details" and "Save as a file". Your name, e-mail addresses and keys are left out.

## 3.0.2

(Published as 3.0.2, before versions were dated.)


- Everything Job Hunt does in the background now shows at the top of every page with a progress bar and a Stop button: searching, reading new roles, preparing a CV and letter, finding people, bringing things over. After you stop something, Job Hunt leaves it alone for half an hour unless you ask for it.
- The Job Hunt logo is back: in the app, on the desktop and Start menu, in the installer and the side panel.
- Fit scores are coloured by how good they are: green, blue, amber, red.
- Rest the pointer on a button to read what it does (what Mute does, for example).
- Pay is shown in the list of roles when the posting names it.
- The second "Ask Claude" box on Today is gone; the one at the top right does the same.

## 3.0.1

(Published as 3.0.1, before versions were dated.)

- Bringing things over from the old Job Hunt now shows a progress bar: what it is doing (which CV, how many jobs) and how far along it is.

## 3.0.0

(Published as 3.0.0, before versions were dated.)

The first release of the rewritten Job Hunt. It installs next to the old Job Hunt and does not change it.

- A proper installer: no administrator needed, Start menu and desktop shortcuts, and an entry under Windows' installed apps to remove it.
- Job Hunt can start quietly with Windows so it keeps searching (a tick box in the installer).
- On first run it offers to bring everything over from the old Job Hunt: roles, CVs, people, interviews and watched job sites.
- Searches LinkedIn, company boards, Job Bank, FreeHire, job sites, recruiters and plain careers pages.
- Tells you when a newer version is ready, with a download link.
