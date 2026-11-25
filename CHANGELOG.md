# What changed

The newest version is first. The release build publishes the top section as the release's notes.

## 26.11.52

- **Job Hunt is now just "Job Hunt"**: its shortcuts, Start menu and Windows' list of apps no
  longer say "Job Hunt 3". The previous app's shortcuts and its entry in the list of apps become
  **"Job Hunt Old"**, and the bring-over card calls it that too. Nothing of the old app is removed,
  and your data stays where it is. A desktop shortcut you kept is kept under the new name.

## 26.11.51

The last pieces from the old Job Hunt.

- **Interview prep reads up on the employer.** Each prep pack now has what Claude read on the web
  about the employer (what it does now, recent news, the team), each with a link to the page, and
  uses it for the questions to ask them.
- **Letters are addressed the way the posting asks.** When a posting names who to write to, the
  letter says "ATTN: Name, Title" and "Dear Name,"; when it gives a reference or competition
  number, the subject quotes it ("Application for Tax Manager (Ref. 12345)"). Applies to roles
  read from now on.
- **A second look at titles.** A posting whose title's wording doesn't match yours (another word
  for the same job, another country's wording) gets one quick check by Claude before it is set
  aside; the same work under another name is brought back and read. Only titles are sent.
- **Pay floor fixed.** A floor set per hour, day or month was compared with yearly pay, so it
  never set anything aside. Pay in another currency than where you will work is never compared
  with your floor.
- **More cities count their own area**, as Toronto does: Edmonton, Winnipeg, Halifax, Hamilton,
  Kitchener-Waterloo, Victoria, Quebec City, San Francisco, Los Angeles, Chicago, Boston,
  Seattle, Dubai, Sydney, Melbourne, Singapore, Dublin and Manchester.

## 26.11.50

The rest of the old Job Hunt, rebuilt.

- **Settings** has its own page, with a menu down the side: Connections, Browser side panel, The
  app, Debugging. Old links still land in the right place.
- **Mail.** Job Hunt writes a reply, follow-up or thank-you only when you press Write it. New
  switches on the inbox card, all off at first: save drafts in Gmail in the thread; send one
  message with one press from your own address (it shows who, the subject and the text first);
  label the mail it reads (JobHunt/Applied, JobHunt/Recruiters); find recruiters in two years of
  mail. Recruiters can be saved as a spreadsheet.
- **Submit application.** After the side panel fills a form, it lists what was filled and a Submit
  button that sends that one form when you press it, then marks the role applied.
- **Google Calendar, both ways**, with a key you make once (steps in Settings, Connections):
  interviews go in with a prep block and reminders; moves and deletions there come back here.
  An interview deleted there keeps its notes with the role.
- **Another AI** (ChatGPT, Gemini, Grok, Groq, OpenRouter or a model on your computer) can do the
  searching or everything; Claude takes over whenever it fails.
- **Search.** Say what you want (level, permanent or contract, industries, deal-breakers, career
  path) and roles are tagged On path / Off path. Every place you list is searched for every
  title. Each source shows what became of each posting. Set-aside roles can be scored again;
  Search now ignores the schedule; search times are suggested from when roles were posted; a
  pasted key is tried before it is saved. New employers are found by themselves, dead job boards
  dropped, company ratings looked up (★, and an optional floor), untouched roles cleared after
  30/60/90 days (off at first), budget mode (off at first), a model per task, and Indeed through
  your Claude account's connector (Claude Code sign-in).
- **Leads**: a new page for hiring posts the side panel reads on LinkedIn, funding news, and leads
  you paste. Each is sized up with who to write to; the note is written when you ask.
- **Progress** goes deeper: 7/30/90 days, results by CV, fit, kind of role and pay, where roles
  turn up, Claude's weekly reading, and what your no's say, fed into tailoring (can be switched off).
- **This computer.** Wakes the PC for searches and says when Windows slept; keeps your tailored
  CVs and letters in a folder; installs and signs in to Claude Code with one button; a folder
  picker; a choice of browser; a "Send to Job Hunt" bookmark and optional pick-up of copied job links.
- **Side panel** updates itself, fills a job site's own profile from your CV, and adds a
  posting's hiring team to People.
- **Two computers.** Carry on where you left off on another computer; "Hand over" saves a fresh
  copy; an applications spreadsheet is kept in the copies folder.
- **Phone.** Edit letters, ask for changes, write follow-ups, People, add a role from a link,
  search now, and add Job Hunt to the home screen.
- **CVs.** Each CV has its own titles, words and letter style, Find more titles, Replace file, a
  screening check and what Claude read. Replacing a CV rewrites waiting roles and keeps your edits.
- **LinkedIn through Apify.** Test now runs one real search (10 postings, about a cent) and marks
  the source Working, or says plainly when nothing came back. Saving a key only checks the key.
- A note you write on a lead is no longer lost if the lead is being sized up at the same moment.
- Also: LinkedIn note length 300 or 200, Write all follow-ups, a role beside the list on wide
  screens, and a daily reminder until an update is installed.

## 26.11.49

- Testing a job source under Connections (Google for Jobs and the others) no longer breaks the
  page with "ago is not defined". A new check stops a page that uses a missing helper from
  being released.
- Releases no longer download the installer builder, which failed when its site was down, and a
  release that fails for an outside reason is tried once more by itself.

## 26.11.48

- The old Job Hunt's keys for Adzuna, Jooble, Google for Jobs and Apify now come over. If you
  already brought your data over, they come over once on the next start. A key you already set
  here is never replaced.
- New source: LinkedIn through Apify (You, Connections, More job sources). It runs LinkedIn's own
  search through a scraper on Apify, so postings arrive with their whole description and
  applicant count. It is used on full searches only, one run per title. Apify bills per posting.

## 26.11.47

- **Applicant counts are honest, and exact when you open the posting.** Job Hunt reads LinkedIn without signing in, where a new posting only says "Be among the first 25 applicants"; that was kept as 24 and shown as "24 applicants", so every fresh role looked the same. It now says "under 25 applicants" (and "100+" or "200+" where LinkedIn gives only a bound). When you open a LinkedIn posting with the side panel open, it reads the exact count LinkedIn shows you signed in (exact under 100) and Job Hunt keeps it; a later search that sees only "under 25" does not overwrite it. Update the side panel too: Load unpacked again, or reload it on the extensions page.

## 26.11.46

- **Long requests through your Claude sign-in no longer fail on Windows.** Reading your career path stopped with "The filename or extension is too long": Job Hunt put your CV and profile on Claude Code's command line, which Windows caps at about 32,000 characters. They now go through a private file that is removed straight after.

## 26.11.45

- **Career path shows where each route leads, and its ceiling.** Pay in 3, 5 and 10 years was the starting role with raises, which kept the numbers low. It is now the pay of the role you would hold by then as you are promoted, named under each figure, with a new Ceiling column: the top of the route as people usually reach it and what it pays. The currency is written out (C$, and "in Canadian dollars"), not a bare $. Your career page reads itself again once to fill these in.

## 26.11.44

- **Today's numbers sit in the top bar, beside "Today".** Ready to send, applied this week, in conversation and people who know you no longer take a row of their own, so the list starts higher. On a narrower window the ones that don't fit drop out whole; hover a number for its detail.

## 26.11.43

- **"Never show" limits apply to roles already found.** Ticking contract, part-time or internships under Never show (or the pay floor, or the age of postings) only stopped new postings; the ones already in your lists stayed. Now every role you haven't saved or applied to that a limit rules out is set aside at once, with the reason, including ones Job Hunt prepared on its own (their CV and letter are kept). Untick a limit and the roles it set aside come back. Roles you said not interested to never come back. Limits you set earlier are applied the first time this version starts.

## 26.11.42

- **The old Job Hunt's jobs are cleared out, except the ones you applied to.** Once, on the first start of this version: every job brought over from the old app that you never applied to goes, with its letter and history. Kept: everything you applied to (with interviews, offers and noes, the CV and letter sent), and every job you said not interested to, still closed, so it never comes back. A copy of everything is saved first, under Settings, Saved copies ("Before clearing the old Job Hunt's jobs"), and can be put back. Bringing things over from the old app again now brings only what you applied to.

## 26.11.41

- **A sharp icon on the taskbar.** Job Hunt's window took its icon at the smallest size and Windows stretched it on a scaled screen, so it looked blurred next to other apps. It now takes the size your screen draws.

## 26.11.40

- **Words a screening system looks for** now matches whole words only. Short ones like "AI" or "ERP" were being ticked when they only appeared inside other words ("trained", "enterprise").
- **Applied there before?** now also counts applications brought over from the old Job Hunt, and ones where you sent your own CV file.
- With your own CV file chosen, **Check my CV** and the word check read your file, not Job Hunt's version.
- **On their own site** only links an open posting with the same title in the same town.
- **Near misses on Today** are the ones tailoring would carry over your bar, not every role a little under it.

## 26.11.39

- **Before you send**, on every role with a CV ready. **Check my CV** reads the CV exactly as it will be sent and says, for each thing the posting asks for, whether it is shown, unclear or missing, with **Make it clear** for the unclear ones. **Words a screening system looks for** shows which of the posting's words are in your CV; tick the missing ones and **Work in the ticked words** (only where your CV or facts support them). **Will a screening system read it?** checks for a missing phone or e-mail, undated roles, length and odd symbols.
- **Copy-and-paste kit**: name, e-mail, phone, LinkedIn, city, current title, right to work and each role's title, dates and text, one Copy each, for forms that make you type it all.
- **Use your own CV or letter file** for a role. The downloads and the side panel then hand over your file instead of Job Hunt's, until you press **Use Job Hunt's again**.
- **Applied there before?** A new CV for an employer you already applied to stays close to the one they have, and the role page says so, with **See what differs**.
- **Fit once tailored**: before anything is written, a role shows what its fit would likely reach once tailored. Near misses that tailoring would lift over your bar now stay on Today instead of being set aside.
- **An offer**: paste it on the role and Job Hunt weighs it up (against the market and your pay floor), lists what's worth asking for and drafts the reply. **They said no**: a short, gracious reply to send. **Practise this interview** opens Claude to ask you one question at a time.
- **On their own site**: for a role found on LinkedIn or another board, Job Hunt looks for the same posting on the employer's own careers site, so you can apply there.
- **Your handwritten signature** in letters: add a picture of it under You → Letters and follow-ups and it goes under the closing in every letter, Word and PDF.

## 26.11.38

- **About you, one line per group.** You, What to look for, Hard limits, What matters to you, Letters and follow-ups, and What Job Hunt does by itself each show what is set in one line. Each opens where it sits and saves on its own, so there is no long form with one Save at the bottom. The long list of nearby places is folded away. "Find a setting" opens the right group.
- **Titles with a comma are kept whole.** Saving About you (or the first-run setup) split a title like "Director, Tax Technology" into "Director" and "Tax Technology". Titles now split only at line breaks. If you saved your titles before, look at What to look for once and join any that were split.

## 26.11.37

- **Career path is back**, as its own page under Progress. Claude reads your CV and shows three ways it can go from here: a step up, sideways, or the same level somewhere new. Each shows how well your CV fits today, what it pays now and in 3, 5 and 10 years (Claude's estimate; check it), what's missing, and **Search these titles**.
- **The plan** for a route lists each gap, how many of the postings Job Hunt saw ask for it, the smallest thing that closes it and how long that takes. **Mark done** stays done when the plan is read again.
- Also: titles to try this week, and how your own applications to that kind of role have gone. It is read again every Monday, or press **Look again now**.
- Every number of postings is counted by Job Hunt from what it has actually seen, not guessed. Until it has seen a few for a route it says so.
- Connections: the "More job sources" line no longer says sources are set up when they have no key.

## 26.11.36

- **Radar in four tabs: Fresh now, Sources, Employers, Titles.** Sources lists every place Job Hunt looks with the ones that aren't working first, each with what went wrong and a button: **Set it up**, **Try now**, or **Fix the 3** for employers' boards that didn't answer. The tab shows a red count when something is wrong, and the top card links straight to it.
- **Connections, one row each.** Claude, your inbox, your calendar, phone notices, Job Hunt on your phone, more job sources, search times and this computer are each one line saying whether it is working, and open where they sit. Everything that was on the page is still there. "Find a setting" opens the right row.

## 26.11.35

- **Which sources aren't working, at a glance.** Radar's top card now says when a source isn't working ("LinkedIn isn't working", "3 sources aren't working") with a link to **Where Job Hunt looks**, which now sits above the employers list instead of below it. Employers' own job boards that didn't answer are named, each with the reason.
- Key fields no longer look like password fields to password managers, so they don't offer to save or suggest a password there.
- If Job Hunt's own window can't open once, it is tried again the next time instead of using a plain window for the rest of the session. Why it couldn't open is written to the log ("Copy details" under You → The app and debugging).
- Where each employer's logo came from is written to the same log.

## 26.11.34

- **1Password (and other password managers) stop prompting in Job Hunt.** The key, inbox and calendar fields looked like a sign-in form to them. Every field now tells them it is not one.
- **Job Hunt's own window, even when it can't start.** It is meant to open as its own window (since 26.11.29). On a computer where that part of Windows is missing or fails, it used to fall back to an Edge window with your own browser profile, so your extensions, 1Password among them, ran inside it and it looked like a browser. The fallback now uses a profile of Job Hunt's own with no extensions, and the reason is written to the log so "Copy details" shows it.

## 26.11.33

- **Wrong employer logos, second fix.** The window kept the old wrong pictures for up to a week, so the yellow icon stayed on BMO, Rogers and others; it now asks again. "(Canada)" in an employer's name was taken for a short name, which gave CIBC the logo of canada.com. A guessed address is now also refused when it is a domain for sale, or when it sends you on to a site without the employer's name. Logos are looked up once more after this update.

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
