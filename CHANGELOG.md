# Changelog

All notable changes to Job Hunt. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
This file is generated from `static/changelog.json` by `python tools/release_ci.py sync`; edit that file instead.

## [2.65.6] - 2026-11-13

Update everything now.

### Changes

- Me, CVs has Update everything now: what a change of CVs left to score or tailor again starts at once, with its progress at the top of the page (Job Hunt otherwise looks every half hour). With nothing waiting, it offers to redo it all anyway.

## [2.65.5] - 2026-11-13

Removing and adding CVs leaves nothing undone.

### Changes

- After CVs were removed and added, roles stayed without a fit and applications waiting for approval were not tailored again. The work to redo was kept as a list at the moment of removal, and lost whenever it could not be done right then (the CV it was to use was removed in turn, Job Hunt was closed, Claude was at its limit). Job Hunt now reads what is owed from the jobs themselves, does it when a CV is added or removed, and looks again every half hour, so the ones stuck now are picked up too.
- Removing a CV no longer clears the fit of roles that were set aside; they keep it, as when a CV is updated.

## [2.65.4] - 2026-11-13

Indeed's notice: Claude Code's own words.

### Changes

- A source's notice about signing in now includes what Claude Code itself said, so a connector that needs reconnecting can be told from Claude Code being signed out, and it says when it was last tested.
- After Sign in to Claude from a source's notice, that source is tested again by itself, so the notice is not left showing an old result.

## [2.65.3] - 2026-11-13

Sign in to Claude opens its window.

### Changes

- Sign in to Claude (and Install and sign in) did nothing: a slip in the button's code meant the request to open the sign-in window was never sent, though a message said a window had opened. It opens now, and says so plainly if it can't.

## [2.65.2] - 2026-11-13

The fix beside the problem.

### Changes

- When a source can't work because Claude Code is signed out, its notice now has the Sign in to Claude button on it (under Needs attention and in the list of sources), not directions to another page.
- The last place in Settings is called App again, not This computer.

## [2.65.1] - 2026-11-13

Indeed: the right reason.

### Changes

- Indeed still said Claude Code isn't signed in when it is: the check that tells the two apart was stricter than the one Accounts uses. They now agree, so a connector that needs reconnecting is said to be that.

## [2.65.0] - 2026-11-13

Settings, regrouped, with a search.

### Changes

- Settings has eight places down the side, each thing in one of them once: Accounts, Job search, Applying, Email & calendar, Notifications, Phone, Sync & backup and This computer. The bigger ones have tabs inside.
- Search settings (the box above the places, or press /) lists every setting that matches, with where it is; opening one goes to its page and lights it.
- Google is one card in Accounts, showing Gmail, Calendar and Drive with the way to each one's settings. Sync & backup no longer has a sign-in of its own.
- Job search, Sources is one list in groups (job sites, employers' own sites, recruiters, sent to you). Each source has its state, what it last found, its buttons, and its set-up folded under it. Where it looks and Set up sources were two pages; Last search is a tab of its own.
- When Job Hunt searches, how much it scores, and how it tailors moved from Me, Looking for to Settings (Job search, Applying). Looking for keeps what describes the jobs you want.
- Everything to do with your phone (using Job Hunt there, filling in forms, sending jobs) is under Phone. Older links to a settings page still open the right place.
- Indeed said Claude Code isn't signed in while everything else Claude does was working. When the Indeed connector itself needs signing in to again, Job Hunt now says that, with where to reconnect it (claude.ai, Settings, Connectors). And when Claude Code really is signed out, the notice points to Sign in to Claude in Settings, Accounts, not to a terminal.

## [2.64.0] - 2026-11-13

Every role shows; a warning only for a real setback.

### Changes

- Job Hunt no longer marks roles On or Off your path. Every role shows up, and you are warned (Could set you back, with the reason) only when taking one would significantly set your career back: a clear step down, a dead end, or a move out of your profession into unrelated work, such as a financial analyst taking a restaurant manager's job. A different industry or product area in the same kind of work, tax to AI say, is never a warning. This works with or without paths kept open.
- Keeping a path open also adds its job titles to your search, so its roles show up from the next search. Take titles out under Me, CVs.

## [2.63.0] - 2026-11-13

Keep several career paths open.

### Changes

- You no longer have to settle on one career path. Keep as many open as you like (Me, Career: Keep this path open on any path, or add one in your own words, such as product management in any industry). A posting is marked On your path when it moves you along any of them, and Off your path only when it leads to none.
- Your paths are shown as chips you can take off one at a time.

## [2.62.2] - 2026-11-13

Career paths: a quieter Recommended.

### Changes

- Recommended is a small mark under a path's name (with why, on hover) and a thin line at the row's edge, in place of the large blue pill and the tinted row. On the path's card it is a soft tag.

## [2.62.1] - 2026-11-13

CV update: stop it, close it, and a tidier card.

### Changes

- The update after a new CV can be stopped (Stop: it finishes what it is on and starts nothing more) and its card closed once it is done or stopped.
- Removing a CV stops an update running for it and takes its card away. Giving a CV another file while an update runs stops that one and starts afresh.
- The card is tidier: a finished step is a tick and one line, bars are thin and only on the step being done and the ones to come, and the link to your career paths stays on its line.
- Top bar: with an update waiting, the Update ready chip ran under the theme button. Each thing in the bar now keeps its own width; the find box and the search status give way instead.

## [2.62.0] - 2026-11-13

CV update: only what cleared your bar, with a bar for every step.

### Changes

- Updating a CV scores again only the roles that had cleared your fit threshold (the ones waiting for you to pick, and saved ones above it). Roles that were set aside or dismissed keep the fit they had. It was scoring again every role that CV had ever scored, some 1,800 of them.
- The fits that the last two versions cleared from set-aside roles are put back, once, when Job Hunt starts.
- Every step of the update has its own progress bar with a count (47 of 128), or a moving bar where there is nothing to count, and the card says which step it is on. The applications being tailored again are counted off as each is ready.

## [2.61.2] - 2026-11-13

The Workday form: no more crawling, and what it chose is seen.

### Changes

- A form took fifteen minutes and looked stuck when its tab was behind another one: browsers slow a hidden page's timers to one a second, then one a minute. The extension now keeps the time itself there, and the panel says so while the tab is hidden.
- Workday chooses an item by itself when a search has one match (Other School, Not Applicable - Not Applicable). Job Hunt did not notice, searched on, and reported the box as not filled. It now sees what was taken and moves on.
- Field of Study and the first skill were not taken: the browser's debugging bar came on at the first click and closed the open list. It now comes on before the list is opened.
- A certificate is also searched for by its full name (PMP as Project Management Professional, and other common ones), and the name after the issuer is read (Project Management Institute - Project Management Professional).
- While it looks through a site's list, the panel says what it is looking for. No Items is no longer read as an option, so an empty search is given up at once.
- No amber on the end date of the job you are in, or on a certificate's optional upload box.
- Copy details lists what each search showed, so a missed item can be traced to the site's own wording.
- All jobs: the stage on each row (Ready to approve, Approved – submit it) is a small one-line tag again.

## [2.61.1] - 2026-11-13

All jobs: buttons one size.

### Changes

- The button on each row of All jobs (Apply, Approve, Tailor) is the same size whatever it says, with the Not interested cross in the same place beside it. On a role that was set aside it now reads Tailor, like the others.

## [2.61.0] - 2026-11-13

One company, whatever it's called.

### Changes

- Bank of Montreal and BMO were two companies to Job Hunt, so one had a logo and the other did not. Well-known employers that go by several names (BMO, RBC, TD, CIBC, Scotiabank, National Bank, EY, PwC, MUFG, JPMorgan, Sun Life and more) are now one company each: one logo, Applied here before and the count of roles across every spelling, and the same posting from two sources kept once.
- The company shown as mufgub (its code on Workday) is now MUFG.
- Logos: a second public index of site icons is asked when a company's own site and the first index have none, and every company without a logo is looked up again.
- All jobs: the table is always exactly as wide as its card. With long names, both fit scores and two buttons in a row it grew wider than the card, which then scrolled sideways and left the Company column out of sight. Every column now has a set width and long text wraps; in a narrower window the least needed columns step out (Type, then Location, Salary, Age) rather than being cut off.

## [2.60.0] - 2026-11-13

Update a CV, and everything follows.

### Changes

- Give a CV a newer file (Me, CVs: Update this CV, or drop the file on that CV's card) and Job Hunt brings everything worked out from the old one up to date, in the background.
- Every job waiting for you to pick, and every saved one, is scored again against the new CV. It used to stop at the per-search cap and leave the rest Not scored. If Claude reaches its limit part-way, the rest are scored when it resets.
- With more than one CV, waiting jobs that another CV scored best are scored again too, since the new CV may now be the better match.
- Applications waiting for your approval are tailored again from the new CV, and so are the ones you approved and have not sent yet, so a stale CV is never what you submit. Those stay approved; the card counts them off, and Put back as it was restores the earlier files. The form answers written for them are written again. Ones with your own file or edits keep what they have, and what you sent stays as it went out.
- Your career paths are rewritten from the new CV, and the coach's advice if you have any.
- Claude reads the new CV for job titles and keywords the old one didn't suggest and adds them to the search. Yours are never removed.
- Open leads you have not written to are read against the new CV again.
- A card at the top of the CVs page shows each step and how far it is.

## [2.59.0] - 2026-11-13

The extension, rebuilt so it can't hang.

### Changes

- Fill in this form no longer hangs on Reading the questions when Claude is slow. The extension used to wait on one long request to Job Hunt, which a browser can drop without a word; it now hands the form over and checks back every second or two, so nothing is lost if the browser puts the extension to sleep.
- It puts right what it can by itself: a request Job Hunt did not answer is asked again, the form is sent again if Job Hunt restarted meanwhile, the page's script is replaced when it is from before an update, the browser's debugger is turned on again if it came off mid-list, and one box that fails no longer stops the rest.
- The panel says what is happening while you wait (Claude is taking longer than usual, or Job Hunt isn't answering) and gives the button back with the reason when it cannot go on.
- Everything it does is logged, with no answers in it. Copy details on the form now includes that log, the extension's own button has Copy the extension's log, and Job Hunt keeps the latest in extension-log.json beside your data.
- Carries 2.58.2: the All jobs table fits its card, logos in the table, pay figures read as money, and no Closes today on an expired posting.

## [2.58.2] - 2026-11-13

All jobs: a table that fits.

### Changes

- The All jobs table fits its card: the next step wraps instead of running over the age, and on narrower windows the Type column is left out so nothing is cut off.
- Each company shows its logo in the table.
- Pay written as bare figures reads as money (CAD 85,500–185,000).
- An expired posting no longer also says Closes today.

## [2.58.1] - 2026-11-13

Logos for companies that apply through Workday.

### Changes

- Companies whose jobs are only on a hosting site such as Workday (Royal Bank of Canada, MUFG) had no logo: Job Hunt had no company site to take it from. It now tries the site of well-known employers, the company's code on the hosting site (rbc gives rbc.com) and its initials, and looks again for every company it found no logo for.

## [2.58.0] - 2026-11-13

Searches only at their scheduled time, and the PC wakes for them.

### Changes

- A scheduled search now runs only during its own hour. One that was missed (Job Hunt closed, the computer off, an update being installed) is skipped, not run when the app next opens or restarts after an update. Search now still runs one whenever you like.
- Adding employers by itself no longer starts a search: their jobs come with the next scheduled one.
- The search times every install began with (7 AM, and 4 PM for a second) move once to noon and 5 PM, just after the two times of day most postings go up. Times you chose yourself are kept.
- Settings, Job sources, When shows the hours your own postings went up, and offers the two search times that follow from them once 40 postings say when they were posted.
- Job Hunt now wakes this PC from sleep for its scheduled tasks unless you turn that off (Settings, App), and turns on Windows' "Allow wake timers" for when the PC is plugged in. It already keeps the PC awake until the work is done.

## [2.57.0] - 2026-11-13

Recommended career paths, and the Workday form fixes.

### Changes

- Me, Career now marks the one to three paths Claude recommends: listed under its advice with the reason for each, starred in the comparison table, and outlined on their cards with why it recommends them and what you give up.
- Think again once to get the picks: paths mapped before this update have none marked.
- Workday forms: a search list that stayed open is no longer read as the next dropdown's options (it left languages unchosen), and choosing by keyboard works when the first row is only marked, not really under the keys.

## [2.56.1] - 2026-11-12

Workday forms: skills, school, certifications, languages and the CV upload.

### Changes

- Skills are now actually chosen on Workday: the highlighted first row was being read as already chosen, so nothing was clicked. Skills the site did not keep are all reported.
- School or University and Certification are chosen from the site's list. When your school or certificate is not in it, Other is chosen and the panel says so.
- A second certification is added when your CV has more than one, and education gets as many entries as your CV has degrees.
- Languages: the whole list is read (it was cut short on long lists), each entry gets its own language and levels, and I am fluent follows that language.
- Your tailored CV is attached to an upload box that only says Select files under Resume/CV, and Job Hunt checks the file shows.
- Education From dates are filled, and a career break is no longer added as a job with no company.
- The browser's debugging bar goes away as soon as the form is filled.

## [2.56.0] - 2026-11-12

Rejections you can see, a career path, and a tidier top bar.

### Changes

- A rejection now shows up: you get a notice, it appears in the Queue under Turned down, and no follow-up is drafted for a role that said no. Drafts Job Hunt saved in Gmail are listed too.
- You can ask for changes to a drafted reply before sending it.
- Inbox shows a count of new email about your applications, and each email has its actions: draft a reply, open the application, open it in Gmail.
- Choose a career path (setup, Me > Career, or Looking for). Postings are marked On your path or Off your path with the reason, and offer advice says if accepting would set your goal back.
- Insights has its own place in the top bar, and its layout is fixed. Search, email and sync each show as their own status, with the theme button beside them.
- What Job Hunt did lately lines up with the page and is open by default.
- A newly pasted key (Adzuna, Google for Jobs, Jooble, Apify, another AI) is tested first and only saved if it works.
- Job Hunt no longer updates while you are doing something: it waits for ten quiet minutes and tells you a minute before.
- Every tailored job has Check my CV, which reads it one requirement at a time as an AI screen would.
- Form filler: saved answers no longer repeat across language or education entries, shorter panel messages, and Copy details now records what each box was meant to hold.
- More company icons are found.

## [2.55.0] - 2026-11-12

Every CV is tailored for requirement-by-requirement screening.

### Changes

- Tailoring now assumes any employer may check your CV requirement by requirement, by software or a recruiter with seconds: each requirement you meet is stated in one clear line, backed by experience and not only a skills list, with total years stated when your dates add up.
- Every tailored job has Check my CV: Claude reads the CV as an AI screen would and marks each requirement Meets, Undecided or Not shown. It still runs by itself only for employers on Ashby.

## [2.54.0] - 2026-11-12

Your CV, checked the way Ashby's AI checks it.

### Changes

- For an employer on Ashby, Job Hunt now reads your tailored CV the way Ashby's AI review does: the requirements a recruiter would set from the posting, each marked Meets, Undecided or Not shown, with the line of your CV it would quote.
- Anything it can't decide, though your CV has the evidence, is reworded to say it outright, then checked again. Wording only, and it can be undone like any revision.
- This happens by itself after tailoring for an Ashby employer. Open the job and look under the Ashby note, or press Check my CV on one tailored earlier.
- Tailoring for Ashby is sharper: evidence goes in the experience and not only a skills list, total years are stated when your dates add up, and the summary leads with the top requirements.
- Answers written for an Ashby form are kept in step with your CV, because Ashby can compare them.

## [2.53.0] - 2026-11-12

Learns from your rejections, and knows how Ashby reads applications.

### Changes

- Claude studies your rejection emails: what they say (most give no reason), how fast they came and at which stage. Find it under Me, Insights, What your rejections say. What it learns is handed to every CV and cover letter tailored after that.
- Job Hunt reads your rejections again as more arrive.
- Employers on Ashby: the tailored CV states each requirement you meet in one clear line, because Ashby's AI review marks each requirement met, not met or undecided and quotes your CV as the evidence.
- A job on Ashby shows what to watch for: screening questions that reject at once, answers checked against your CV, limits on repeat applications, and that a link from someone inside skips the automatic rules.
- Rejected jobs offer a short, gracious reply, saved to your Gmail drafts.
- Phone: the menu button is gone. Search, email, sync and one theme button sit in the top bar. Reload the page once.

## [2.52.1] - 2026-11-12

The phone's top bar, without a menu.

### Changes

- On a phone the menu button is gone for good. The search, email and sync statuses sit in the top bar, and where the menu was there is one button that steps through Auto, Light and Dark.
- A page your browser kept from an older version no longer shows the old menu.
- Also in this release, from 2.52.0: Draft a reply on a rejected job.

## [2.52.0] - 2026-11-12

Draft a reply to a rejection.

### Changes

- A rejected job now has a Reply to the rejection card: Draft a reply writes a short, gracious note that thanks them, asks for feedback only if you interviewed, and asks to be kept in mind.
- With Gmail connected it is saved as a draft, as a reply to their email when a person sent it. If their email came from a no-reply address, Job Hunt says so and addresses it to the person you dealt with instead.
- Nothing is sent: you read it and send it yourself.

## [2.51.1] - 2026-11-12

Settings sits with the other places.

### Changes

- Settings is now beside Queue, Inbox, Calendar and Me, in the top bar and in the phone's tabs; the gear is gone.
- On a phone the menu button is gone: tap the status at the top (Searched 5 min ago) for a small card with the search, email and sync lines and light or dark.
- Also in this release, from 2.51.0: Never show this company, a Queue number that counts only what waits on you, Practise this interview, and a tag on several roles at one company.

## [2.51.0] - 2026-11-12

Skip a company for good, practise interviews, a calmer badge.

### Changes

- Not interested has a new answer, Never show this company: it joins the companies you skip, and its other new postings go with it.
- The number on Queue now counts only what is waiting on you (approve, submit, follow up), not new matches still to pick from.
- Practise this interview, on a job's Interview tab: Claude plays the interviewer in the job's chat, one question at a time, with feedback on each answer.
- When a list has several roles at one company, each shows a tag; press it to put them side by side.
- On a phone, the menu no longer hides Settings under the top bar.

## [2.50.1] - 2026-11-12

A tighter heading over the Queue's lists.

### Changes

- The sort menu and filters sit on the same line as the list's title, and Select all sits at the start of the Sort by row, so the heading takes two lines instead of three.

## [2.50.0] - 2026-11-12

One logo per company, and every list sorts.

### Changes

- A company spelled two ways (Scotiabank and jobs.scotiabank.com) now shares one logo, and a job found on a company's own site is named for the company, not the site's address.
- Logos are only taken from a site that is really the company's, so a wrong icon no longer appears; when the company's site isn't known, its likely address is tried, so more companies get a logo.
- Every table has column headers, and pressing a header sorts by it (again to reverse).
- The Queue's lists have a Sort by row: Role, Company, Location, Pay, Found and Fit.

## [2.49.0] - 2026-11-12

Leads: hiring posts and newly funded companies.

### Changes

- A new Leads tab in the Queue: people saying they are hiring, and companies that just raised money, to write to directly before or instead of applying to a posting.
- The extension reads hiring posts from LinkedIn: open one of the post searches Job Hunt gives you for your job titles, press the extension's button, and choose Send this page's hiring posts. Any other page can be added as a lead too.
- Claude can look on the web for seed and Series A rounds and founders' own hiring posts in your field: when you ask, or once a day if you turn that on (it is off to begin with).
- Each lead shows how well you fit, where you would help, things worth saying, and who to write to, with their profile and a likely or published email address.
- You write the message yourself, with a rough draft if you want a starting point. Job Hunt keeps who you wrote to, suggests one follow-up after a week, and notes who replied.

## [2.48.0] - 2026-11-12

Profiles on job sites, one look for scores, and less repetition.

### Changes

- The extension can fill in your profile on a job site (Job Bank's, say) from your CV. When Job Hunt can't tell which application a page is, the last choice is now: Not an application, a profile here, from my CV. A form that takes one job at a time gets your jobs in order, newest first: fill, save it with the page's own button, open the empty form again, fill.
- The extension's panel shows the Job Hunt logo, where it had a plain square.
- The Files and answers page is gone. A job's own page already had everything on it: the next step opens the form, your files are under CV and letter, and every detail a form asks for is under Questions and contacts.
- The separate Review page is gone too. Check and approve on a job opens its CV and letter, with the keywords to tick when cover is thin.
- Old links to both pages still work: they open the job, or the Queue.
- Fit scores are a ring everywhere, as on a job's panel: how much is filled is the score, and its colour is how good the fit is. A forecast of what tailoring could reach is the same ring, paler, with ~ before the number.
- Career paths and Career coach are one Career tab under Me, with a switch between Paths you could take and Skills to build.
- Most applications tailored per search sits right under Tailor by itself, where it belongs (it was under Advanced).
- On a job's Questions and contacts tab, the application questions and the details to copy are one card: What the form asks.
- Forms are filled one way: in your own browser, with the extension. The buttons for a separate Job Hunt window are gone.
- The status at the top right says when Job Hunt last searched; when it searches next is in the Search button's menu.
- Going from tab to tab in the Queue is quick again: it draws at once from what it already has and checks for changes behind it, where it used to fetch every job on each click.
- Company logos: where Job Hunt knows a company's own website (jobs that apply on the company's site), it fetches that site's icon once and shows it in place of the letter. Companies seen only on a job board keep their letter. Nothing is asked of any outside service.

## [2.47.0] - 2026-11-12

Four places, and All jobs in the Queue.

### Changes

- Pipeline is gone as a separate place. Every job is now the last tab of the Queue, All jobs, with search, the Stage filter and the spreadsheet. Tailored files and Insights are under Me. The top bar is Queue, Inbox, Calendar, Me.
- The Queue now shows everything that is waiting. It was only being given the best 8 to approve and 30 to pick, so its count was too low and Best to apply to now missed most of your matches. Your count will go up.
- All jobs no longer loses older jobs you applied to: it used to load only the 2,000 most recently found.
- All jobs shows one fit score on a phone, with the other in words under it.
- The top bar lines up with the page, and inside each group the heading, Select all, Sort and filter and the tick boxes start on one line.
- The version number is under Job Hunt's name at the top left. Press it to see what's new.

## [2.46.1] - 2026-11-12

Tidied inside.

### Changes

- Nothing you can see changes. The app's two largest code files were split into parts and small inefficiencies cleaned up, so future changes are safer to make and to test.

## [2.46.0] - 2026-11-12

A simpler Queue, the hiring team from LinkedIn, and an easier setup.

### Changes

- The Queue's side column is gone, so the list has the whole width. Search for jobs now has a small arrow with the last search, its results and the daily search. Email is a small button beside it, and this week is a line under the heading.
- The Queue's sort and filters sit beside Select all. Review them one by one is gone: List and One by one do the same.
- The hiring team from LinkedIn: send a LinkedIn posting with the extension and the people it lists under Meet the hiring team are saved on the job, with a note written to the first. For a job already in Job Hunt, open it, People, Open the posting, then Send to Job Hunt.
- A note to someone on LinkedIn has Copy it and open their profile. Notes are sized to your account (Settings, Email: 300 characters with Premium, 200 on a free account), and a note to a hiring manager is written differently from one to a recruiter.
- They replied: press it on a person who wrote back on LinkedIn and Job Hunt stops asking you to follow up. Insights shows how often your notes get a reply, by who they went to.
- A first note is offered before you apply, once Job Hunt knows who to write to.
- The guided setup is easier for someone new: it says what you need, shows how far along you are, opens one step at a time, and asks what you are looking for. Getting started has a section on giving Job Hunt to a friend.
- Faster and lighter: the page no longer fetches everything every few seconds when nothing changed, saving a setting no longer reconnects Claude and Google, and the stylesheet lost a sixth of its weight.
- Fixed: a follow-up note written to a person did not show its I sent it button. Fixed: starting sync for the first time could wrongly say this computer has newer data.

## [2.45.0] - 2026-11-12

Less of your Claude plan, another AI, and applying in a row.

### Changes

- Scoring uses less of your plan: four postings are scored in one request, so your CVs and the instructions are sent once for the four. Change it in Settings, Accounts, Claude, Advanced.
- Another AI can do the searching, or everything: Grok, ChatGPT, Gemini, OpenRouter or a model on your own PC. Set it up in Settings, Accounts, Another AI. Looking things up on the web (Indeed, company ratings, recruiters) stays with Claude.
- One search a day, or two: choose in Settings, Job sources, When. The second finds new postings hours sooner.
- The Queue has its own sort and filters again, over every group: sort by best to apply to now, best fit, newest or highest pay, and tick Shows pay to see only the jobs that state their pay, or No red flags. It remembers your choice.
- With more than 40 matches waiting to be picked, a search by itself scores half as many, newest first, so usage goes on jobs you will get to.
- A tailored CV no longer shows a slightly lower fit than before by chance: the two scores are now measured against each other.
- A tailored CV that covers under 60% of a posting's keywords is marked, and Review lists the missing ones to tick if you really have them.
- Apply to all, and Apply to the quick ones, now open each form in your browser one after another: submit, press next, and the next one opens.
- Ready to approve and Review are in the order of what is best to apply to now.
- With fewer than eight to pick, the Pick list's own Sort and filter folds under one line, and a company's coloured letter shows its name when you point at it.
- On a phone held sideways, the Queue's side column goes under the list, so each job has the whole width: its name is no longer squeezed into a few words a line, and List / One by one stays in reach.
- Fill forms on your phone has moved to Settings, Browser extension (it was at the bottom of Job sources). On the phone, that page now says where to get the bookmark: it is handed out on your PC only, because it carries your key.

## [2.44.1] - 2026-11-12

Clearer scores on a phone, and the tabs back at the bottom.

### Changes

- On a phone, a job shows one fit score, with the other in words under it: was 76 once the CV is tailored, or ~97 tailored while it is a forecast. Before, two unlabelled scores sat one above the other.
- On a phone held sideways (or a wide folding one), the tabs are along the bottom again in a shorter bar, instead of down the right edge where some browsers drew them badly. The page now uses the full width.
- The Queue: the Everything count now matches the number waiting for you. A notice about your setup was being counted as a decision.
- On a phone held sideways, Sort and filter starts folded, and the Email line's buttons no longer sit on top of its words.

## [2.44.0] - 2026-11-12

Getting to the best matches sooner.

### Changes

- Pick is ordered by what is best to apply to now: fit, less for every day a posting has been up after its first two, less for red flags and pay below your minimum, a little more for the company's own site. Best fit, Newest and the other orders are still in Sort by. The Queue, one by one, goes in the same order.
- With a long list Pick shows the best 10 only, so you deal with those first. Show all brings back the rest; untick Best 10 only to keep it off.
- Set aside the matches older than three weeks in one click (they stay in Pipeline, and it doesn't change how Job Hunt scores).
- Tailor by itself has a middle setting: Only strong fits (85 or better). After each search the best new matches are tailored without waiting for you, ready to approve. Me, Looking for. It is off until you choose it.
- What you want (Me, Looking for): the level you're going for, permanent or contract, industries you want and don't, and deal-breakers. Scoring weighs them for every new posting, and a role that goes against one says why.
- Indeed, through Claude, prefers the most recently posted roles.
- Fix: adding a chip (a job title, a keyword) by pressing Enter could show an error.
- Pay is on every job, the same way everywhere: in the lists, on a decision and in the panel beside the list. What the posting states, marked when it is below your minimum, or No pay stated when it states none.
- Things line up: in every list the company tile, the name, the fit and the buttons start in the same place whatever the buttons say, and buttons, boxes and tabs share two heights.

## [2.43.0] - 2026-11-12

The Queue as a list, a job beside the list, chips in Me, and the extension reworked.

### Changes

- The Queue shows every listing at once: what to approve, submit, pick and follow up, each group with its buttons and tick boxes. One by one, the single-decision view, is the switch at the end of its tabs; Job Hunt remembers which you chose.
- Pipeline: on a wide window, clicking a job opens it beside the list: where it stands, the next thing to do with its buttons, why it fits and the gaps, its tailored files and the posting. Open the full page is one click further; Esc closes it.
- Me, Looking for: job titles, keywords, companies to skip and title words to skip are chips. Type one and press Enter to add it; the cross removes it. The fit score needed has a slider.
- The extension's button is reworked: whether it is connected to Job Hunt, which application this page is, Fill this form with its shortcut, and a list of the applications you approved with Open beside each, so you can submit them one after another from the browser.
- The panel Job Hunt shows on a form has the same calm look, with one main button and Copy details and Not interested as quiet links under it.

## [2.42.0] - 2026-11-12

Rebuilt around a Queue: one decision at a time.

### Changes

- Job Hunt opens on your Queue: the next decision, on its own, with what you need to decide and its buttons. Pick a match, approve a tailored CV, submit, follow up, prepare for an interview. Skip leaves one for later; Up next shows what is behind it.
- The Queue works from the keyboard: Enter does it, X is not interested, L is later, the right arrow skips.
- A match to pick shows why it fits, what you have that the posting asks for, and the gaps and things to check, with its fit as a ring.
- The menu is a bar across the top: Queue, Pipeline, Inbox, Calendar, Me. Find a job, what Job Hunt is doing, and Settings are on the right. Click the status to see the search, Google, sync and the light or dark theme.
- Pipeline is every job: All jobs, each step as a list (Pick is where you tick several at once), Tailored files and Insights (was Results).
- Inbox and Calendar are two places again: Inbox has Email and Recruiters; Calendar has your interviews and reminders.
- Me starts with what you are looking for (titles, places, how picky), then your CVs, About me, Career paths and the coach.
- Settings (the gear) has Accounts, Job sources (where it looks, what each source found, setting them up), Email, Calendar, Notifications, Sync & backup, Browser extension and App.
- On a phone the five tabs are the five places, and a decision's buttons stay above them by your thumb. Sideways, the tabs run down the right edge.
- Notifications and messages use the new names. Older links still land in the right place.

## [2.41.0] - 2026-11-12

A new shape: five places, a calmer look.

### Changes

- Job Hunt is now five places, each answering one question: Home (what now, and how it is going), Jobs (where every job is), Inbox (who wrote, and when your interviews are), Search (what it looks for, and where) and Profile (your CVs and details).
- Results is Home, Progress. The Calendar is Inbox, Interviews. Tailored files are in Jobs, All jobs. CV & Career is Profile, and Your details is About you. Older links still land in the right place.
- Settings is the gear at the foot of the menu, with what belongs to no one place: Accounts, Email, Calendar, Notifications, Sync & backup, Browser extension, App.
- Find a job is in the menu, so it is on every screen.
- Home starts with one Next up card: the most pressing thing and its button. Everything else waits in a short list under it, and minor warnings go last.
- A calmer look everywhere: a light menu that is part of the page, white cards with hairline edges, tabs as pills, larger type, one accent colour. Light and dark.
- Each job in a list has a coloured tile with its company's initial, so a long list is quick to scan.
- On a phone the five tabs are the five places, so More is gone. The top bar has Find and a menu button with Settings, the status lines and the theme. Sideways, the tabs stay down the right edge.

## [2.40.0] - 2026-11-12

Jobs redesigned, tabs on the right for a sideways phone, and the extension's own Settings tab.

### Changes

- Jobs no longer looks like the old Overview. The steps are one bar across the top, a number over a name each, the one you are on filled in, and All jobs at the end.
- Each job in Pick, Approve, Submit and Waiting is one clean row: its fit, its name and tags, one line with the company, place, pay and age, the reason under it, and its buttons on the right.
- On a phone the list starts much higher: the page's long description is gone, Find a job and Add a job share a line, and Sort and filter is folded under one line until you open it.
- On a phone a job's main button is full width under it, where your thumb is, and the fit sits beside the name instead of pushing it off the line.
- Each group in a step (Ready to approve, Submit on the company's site, No reply yet…) is its own card under a plain heading.
- Messages that still said Applications or Settings, Connections now say Jobs and Settings, Accounts.
- A phone held sideways, or a wide folding phone: the tabs (Today, Jobs, Inbox, Search, More) run down the right edge, by your thumb, and the page gets the full height. A job's buttons sit beside it again.
- The browser extension has its own place: Settings, Browser extension. Its folder, the steps to load it, its key and the download are all there (it was at the bottom of Settings, App). Search's Set up sources and the extension itself point to it.
- The number on the Jobs tab is a proper badge on a phone.

## [2.39.0] - 2026-11-12

Skills on Workday, rebuilt and tested against a stand-in Workday.

### Changes

- Skills and Field of Study: rebuilt. Items already chosen are no longer mistaken for search results, which made the next skill pick the wrong thing or nothing.
- A skill is never unticked again: when the site shows no sign that a click was taken, Job Hunt no longer clicks it a second time. It says which ones to check.
- After a skill the site doesn't have, the following skills are chosen properly (the browser's debugging bar used to come back mid-list and move the page under the click).
- A skill the site doesn't have is given up on in a couple of seconds, not a minute: skills take about a third of the time.
- When a site ignores typing or clicks from the extension, Job Hunt types and presses keys as you would (real typing, arrows and Enter).
- A plainer name is tried when the exact one isn't in the list (Payments for Payments Integration), but never a different skill that shares a word.
- The skills box is no longer filled with the whole list as text before the skills are chosen.
- Fill this form from the keyboard: Alt+Shift+F (change it in the browser's extension shortcuts). The extension's button shows the shortcut.
- Copy details now lists every skill: what was searched, what the site offered, what was chosen and how. Paste it to Claude when something is off.
- Behind the scenes: every release now loads the real extension and fills a stand-in Workday page in six ways.

## [2.38.0] - 2026-11-12

One next step per job, a shorter Today, and your defaults.

### Changes

- Forms open in your own browser by default: Approve opens the form there for the extension to fill, and Fill it in my browser is the main button on the Apply page and on an approved job. A Job Hunt window is still offered.
- Not interested no longer changes how Job Hunt scores: that is the main button now, with Not interested, and learn from it beside it. Setting several aside at once never learns.
- A job's page starts with one Next line for its stage and its one button; opening the posting, Save for later and Not interested sit quietly under it.
- Today is shorter: problems are lines of What needs you with their fix button, and the last search's report moved to Search. The Job search line says what the last search found.
- Search opens with what it is looking for (titles, places, pay) and what the last search found, including why postings were set aside, each reason with a link to the setting that caused it. Sources you don't use are folded away.
- Job titles and keywords can be changed in Search, What to search for, as well as in CV & Career.
- Pick with the keyboard: arrows move, Space ticks, Enter opens, X is not interested, T tailors the ticked ones.
- Waiting: Write all writes every follow-up that is due in one go, for you to read and send.
- Jobs, All jobs has a Tailored files button. Long explanations on the CVs and Apply pages are folded under a short line.
- A little more air: larger headings, roomier cards and rows.
- Behind the scenes: every release is now clicked through in a real browser first (pick, tailor, approve, submit, every page, phone size), and the Windows build is quicker.

## [2.37.0] - 2026-11-12

A simpler layout: Today, Jobs, and every setting under Settings.

### Changes

- Today (was the Overview) is now a short list of what needs you, most pressing first, each with the button that takes you there, above the hunt at a glance: Pick, Approve, Submit, Waiting, Interviews.
- Jobs (was Applications) holds every job in one place. The steps that were on the Overview are here, and All jobs is the list with its filters. Jobs opens on the step that needs you first. Older links still work.
- The menu is in the order you use it: Today, Jobs, Inbox, Calendar; then what you set up once (Search, CV & Career); then Results and Settings.
- Settings has everything: Job search, Email and Calendar are tabs there. The gear buttons on Inbox and Calendar still take you to them.
- Search: Where it looks, What to search for and Set up sources are tabs side by side, and the daily search's on, pause and off menu is on this page and on Today.
- The top of Today is less crowded: Find a job, Add a job and Search for jobs now. Check email now is on Today's Job email line and on the Inbox.
- Notifications say Jobs instead of the Overview.

## [2.36.9] - 2026-11-11

Newest jobs first, an age cutoff, and what's waiting on the Overview.

### Changes

- Scoring goes newest first: the postings put up most recently are scored before older ones, in a search and from the ones waiting.
- Don't score jobs older than (Settings → Search → Which roles, 30 days to start with): older postings are set aside before scoring, using no Claude. Jobs whose posting date isn't known are still scored; 0 turns it off.
- The Overview shows how many postings are found and waiting to be scored, with Score them all now beside it.

## [2.36.8] - 2026-11-11

Low-paid jobs skipped before scoring.

### Changes

- Minimum yearly salary (Settings → Search → Which roles) now also reads the pay a posting gives in its own text ("The salary range for this role is $95,000–$115,000") and hourly rates (2,080 hours a year), so jobs below it are set aside before scoring and use no Claude. It used to read only the salary a job site filled in, so most of them were scored anyway. Starting pay ("From $90,000") and budgets or bonuses don't count as the most a job pays.

## [2.36.7] - 2026-11-11

Scoring shows as scoring.

### Changes

- Score them all now shows what it's doing: "Scoring 40 of 379" on the button, "Scoring waiting postings" in its menu and on the Overview, with how many are done, instead of "Searching · 0%" and "Starting the search". Pause and Resume work on it as on a search, and Stop keeps everything scored so far (the rest keep waiting).

## [2.36.6] - 2026-11-11

Score every waiting posting.

### Changes

- Score them all now: on the Search page, next to the postings waiting to be scored. Job Hunt scores every one of them, 25 at a time, until they're done or Claude's usage limit is reached, and tells you when it's finished.
- Waiting postings are also scored faster on their own: up to 30 every 45 minutes (it was 15 every 90), while Claude has room.

## [2.36.5] - 2026-11-11

Skills chosen carefully, and send jobs from your phone.

### Changes

- Send jobs from the LinkedIn app on your phone: share a job to a Send to Job Hunt shortcut (set it up in Fill forms on your phone), and Job Hunt on your PC adds it, scores it and tells you, through Tailscale. Works from any app or browser that shares a link.
- Skills: accuracy over speed. For each skill Job Hunt waits for Workday's results to finish coming in, compares every option and picks the closest (the same name, else the one sharing most of its words), and if nothing is close searches again shorter ("Payment" for "Payments Integration"). It clicks, waits up to five seconds for Workday to take it, clicks once more if it didn't, and pauses before the next. It never clicks a skill Workday already took (that would untick it).

## [2.36.4] - 2026-11-11

More LinkedIn jobs.

### Changes

- LinkedIn: each search now reads up to four pages of the past week's postings (100), not only the first 25, which in a busy city missed most of them.
- LinkedIn: 16 searches a run instead of 10, so each of your titles in each of your places comes round more often.

## [2.36.3] - 2026-11-11

Your address learned, and Copy details after every fill.

### Changes

- Learning: Job Hunt never kept what you typed in City or Location, because a job entry has a City too. Now your own City and Location (under Address) are kept and filled in next time, while a job's city and an entry's dates still come from your CV each time.
- Copy details is in the panel after every fill: it lists each box on the page, whether Job Hunt had an answer for it and whether it filled it (labels only, not what you typed), to paste to Claude when a page wasn't filled.
- Facts for application forms suggests your address and phone: the first page of most forms asks for them.

## [2.36.2] - 2026-11-11

Skills selected at any browser zoom.

### Changes

- Skills: with the browser zoomed in or out (90%, 110%…), Job Hunt's clicks on Workday's skill list landed beside the skill, so it searched them but none was selected. Clicks now land on the skill at any zoom.

## [2.36.1] - 2026-11-11

Language levels, Field of Study, skills it missed, career transitions.

### Changes

- Languages: a level you give in your facts ("French: beginner") picks the option with that word ("1 - Beginner"), not one that matches how you learned it ("Classroom Study").
- Skills: the panel lists every skill Workday didn't take, to add yourself; before, a later round (the end dates) cleared the list before you saw it.
- Field of Study (and Major and the like) on Workday: typed and chosen from Workday's list like a skill, instead of left empty.
- Work Experience: a dated career break or transition on your CV ("Career Transition") gets its own entry, like a job.
- Copy-and-paste kit: each skill has its own Copy button.

## [2.36.0] - 2026-11-11

Fill in forms on your phone, and a copy-and-paste kit.

### Changes

- Apply from your phone's browser and Job Hunt fills in the form: a Job Hunt Fill bookmark on your phone loads the same form filler as the extension, and gets the answers, your CV and letter from Job Hunt on your PC through Tailscale (only your own devices can reach it).
- Set it up in Search → Set up sources → Fill forms on your phone: Set up with Tailscale shares Job Hunt with your devices (Tailscale Serve, https) and gives the bookmark to copy to your phone.
- On the phone, Workday's skills are chosen as best Job Hunt can (the real clicks need the desktop extension); tick any it missed.
- A copy-and-paste kit on each application's Apply tab, for when filling in doesn't work: your contact details, your facts for forms, each job and school from the CV this application uses (employer, title, From and To as MM/YYYY and as written, its description), skills (also as a list), languages, the answers written for it, the cover letter and the whole CV, each with its own Copy button.

## [2.35.14] - 2026-11-10

Workday dates, one skill at a time, the right number of jobs.

### Changes

- Dates: Workday splits From and To into a month box and a year box, and Job Hunt put the whole date in each ("Invalid Date: /2023"). It now reads them as one date and puts the month and the year each in its own box.
- Skills: Job Hunt typed the next skill before Workday had shown the last one's results, so they weren't selected. It now waits for results that match the skill it typed (up to twelve seconds), selects it, checks it was taken, and only then types the next.
- Jobs: Job Hunt adds as many Work Experience entries as Claude lists roles on your CV, not as many date lines as the CV has (which added empty extras).
- Copy details now also says what it saw when a skill wasn't in Workday's list.

## [2.35.13] - 2026-11-10

Every job added on Workday, skills clicked where they are.

### Changes

- Work Experience: Job Hunt didn't see Workday's Add Another button for jobs when a heading sat inside the job entry, so it never pressed it. It now finds the button by the nearest heading that names the section (or the button's own label).
- Skills: the browser's "started debugging" bar pushes the page down when it appears, so a click aimed before it showed landed above the skill. The bar now comes on before the first skill and stays until the skills are done, and each click is aimed after it.
- Education dates: a school's years in your application facts ("American University of Kuwait: 2005 – 2009") go in From and To, even when the CV gives only the year you finished.

## [2.35.12] - 2026-11-10

Workday skills selected with real clicks, jobs added from your CV.

### Changes

- Skills: the list showed each skill, but Workday ignores clicks a page script makes. The extension now clicks the skill through the browser itself, as your mouse would. Edge or Chrome shows a bar saying "Send to Job Hunt started debugging this browser" while it does; it goes a few seconds after the last skill.
- Keys the extension presses (Enter, Escape, arrows) now reach the page's own code; before, it couldn't tell which key they were.
- Work Experience: Job Hunt presses Add Another for each job on your CV that the form doesn't have, even when Claude's answer for the button comes back as nothing, and it counts the jobs on a CV more reliably (two-column layouts, roles listed on one line).
- The panel has a Copy details button when a skill isn't taken or no jobs were added: it copies what Job Hunt saw on the page, to paste to Claude.

## [2.35.11] - 2026-11-10

Extension kept up to date, and says what it didn't do.

### Changes

- The extension now checks it matches Job Hunt every time you press Fill in this form, not only when you open its button. After a Job Hunt update the old copy kept filling forms with the old script, which is likely why the skill and Add Another fixes didn't show up. Now it updates first and asks you to reload the page.
- The panel says what didn't happen: how many jobs your CV has when Workday's Add Another added none, and which skills Workday didn't take.

## [2.35.10] - 2026-11-10

Workday skills ticked, every job added.

### Changes

- Skills: Job Hunt searched each skill and the match showed, but Workday didn't take it, because it selects on the mouse press and Job Hunt only clicked. Job Hunt now presses like a mouse, checks the skill was taken, and if not tries its checkbox, then the keyboard (arrow down, Enter).
- Every job on your CV: Claude now lists each role on your CV (promotions included), and Job Hunt presses Work Experience's Add for each one the form doesn't have yet, instead of relying on a count.
- Overview: the step numbers (1 to 5) are gone from Pick, Approve, Submit, Waiting and Interviews, so the only number on each is how many jobs are in it.

## [2.35.9] - 2026-11-10

Workday languages and dropdowns fixed.

### Changes

- Workday dropdowns no longer get each other's answers: a list Job Hunt couldn't match an answer in was left open, and the next dropdown took its options from it (a language left on Select One, fluency levels mixed up). Lists are now closed every time, long lists are scrolled to find the answer, and "Fluent" matches "5 - Fluent".
- Languages: Job Hunt adds as many language entries as your CV and your application facts name, not more, with the level you give (a line such as "French: beginner" in your facts); the fluent box is ticked only for languages you're fluent in.
- Every job on your CV: counting the jobs works with CVs whose Experience heading is in capitals or styled, or missing; the panel says what it added ("2 Work Experience").
- Checkboxes: if a tick doesn't take (an open list can swallow the click), Job Hunt closes the list and tries the box's label.

## [2.35.8] - 2026-11-10

Update check when you switch to Job Hunt.

### Changes

- Job Hunt now checks for a new version whenever you bring its window to the front (alt-tab or the taskbar), not only when you open it from the tray, at most once a minute.

## [2.35.7] - 2026-11-10

Workday forms, filled in fuller.

### Changes

- Every job and language on your CV: Job Hunt presses Add under Languages too, and if Claude leaves the work-history Add at nothing, Job Hunt counts the roles on your CV itself and adds that many.
- Workday's dropdowns ("Select One": language, proficiency, yes/no questions) are filled in: Job Hunt opens each to read its options, then chooses.
- Links in full: your LinkedIn goes in as https://www.linkedin.com/in/...
- Skills: when the site's list has no exact match, the closest one is chosen (sharing most of the words).
- Education dates: a school with only the year you finished on your CV gets that year as To, not in both boxes.
- Answers on every page of a Workday form are kept for next time (your GPA, say) when you press Save and Continue, not only the last page's; and GPA is kept now.

## [2.35.6] - 2026-11-10

Find the recruiter on LinkedIn, and the right job on each site.

### Changes

- Find the recruiter on LinkedIn: on a job's People at the company, Job Hunt searches LinkedIn for the recruiter who hires for the role (or the hiring manager), adds them with their profile link, and writes your note to them, ready to copy and send from their profile.
- Notes to recruiters read like you wrote them: "Hi Priya,", contractions, one specific detail, and none of the stock phrases ("I hope this finds you well", "I'm reaching out", "excited", "great fit").
- The extension no longer takes a job you chose on one company's site for another's: a page that names one of your approved jobs' companies (BMO's careers site, say) is that job, and a job you chose from the list counts only on the site you chose it on.
- The extension's popup has "Not this job? Choose another" to pick the job yourself.
- "Just applied: message the recruiter": Write a note now opens the job at People at the company, where a new Write a note to the recruiter button writes it, even when you don't know their name yet (it greets them without one). With a recruiter Job Hunt knows there, it's written to them.

## [2.35.5] - 2026-11-10

Replace a file that's already there.

### Changes

- When an upload box already has a file (often the CV you gave Workday at the start), Job Hunt doesn't add a second one: the panel asks whether to replace it with your tailored CV or cover letter (it deletes the old one with the page's bin button and attaches Job Hunt's) or keep it.
- An upload that Workday took is no longer marked in amber as if it had failed.

## [2.35.4] - 2026-11-10

All your skills, and your CV once.

### Changes

- Skills boxes: Job Hunt adds every skill, not just the first. Workday redraws the box after each one and leaves the last list of matches open; Job Hunt now finds the box again and waits for each skill's own matches.
- Your CV is attached once. Workday empties its upload box after taking a file, so filling in again uploaded it a second time; now a file the page already lists isn't attached again.

## [2.35.3] - 2026-11-10

Extension says when it's updated.

### Changes

- When the browser extension updates itself (after Job Hunt updates), it shows a notification, puts NEW on its icon until you open it, and says in its popup to reload any application form that was open.

## [2.35.2] - 2026-11-10

Form filling works again after an update, and faster.

### Changes

- Fill this form stopped doing anything on a page that was open while Job Hunt updated (Workday's form never reloads): the extension's old copy on the page stopped working and the new one stepped aside for it. Now the new copy takes over, and if the page can't reach the extension it says to reload the page.
- Forms are filled in by Sonnet (the searching model) instead of Opus: a long form with every job and school on it took Opus several minutes, which is why the panel gave up with "No answers came back".
- After unticking "I currently work here" on past jobs, only the end dates that appeared are sent, not the whole form again.
- The panel waits up to six minutes before giving up, and its time estimate is closer to the truth.

## [2.35.1] - 2026-11-10

Tells you when it's updated.

### Changes

- After Job Hunt installs an update and restarts, a green bar at the top says it was updated, to which version, and what's new since the one you had (What's new for the details, Got it to close it).

## [2.35.0] - 2026-11-10

Skills on forms, and choosing the job in your browser.

### Changes

- When the extension can't tell which application a page is for, its panel lists your jobs from the Submit tab (the one the page names is chosen already): pick one and Job Hunt fills the form in for it, and remembers it for the form's other pages.
- Skills boxes (Workday's "Type to Add Skills"): Job Hunt adds 6-10 of your CV's skills that matter most for the job, one at a time: it types each, presses Enter and chooses the closest match from the list.

## [2.34.5] - 2026-11-10

"I currently work here" on Workday, and system senders.

### Changes

- Workday forms: "I currently work here" is answered for each job on its own. Workday names that box the same in every entry, so Job Hunt read them as one question and ticked them all; now only your current job is ticked, and past jobs get their end dates.
- Automatic emails (like "WorkdaySystem_DoNotReply") are no longer taken for recruiters, and ones saved before are removed from your recruiters and job tags.

## [2.34.4] - 2026-11-10

Faster to open.

### Changes

- The Overview no longer waits on Google Drive or your sync folder: it opens straight away, and a newer copy from another computer is noticed a moment later.
- Opening Job Hunt fetches the Overview once instead of twice.
- The window opens without first checking where every saved CV and letter is (that now happens in the background).

## [2.34.3] - 2026-11-10

Past jobs and promotions on forms.

### Changes

- "I currently work here" is ticked only on the job you're in now; Job Hunt unticks it on past jobs (also when the site ticked it) and then fills in their end dates.
- Promotions: each title you held at one employer goes in its own entry on the form, with its own dates and description.
- The browser extension updates itself to this version.

## [2.34.2] - 2026-11-10

Install updates from your phone.

### Changes

- Install and restart now works from your phone (or any browser) over Tailscale: the PC installs the update and restarts Job Hunt by itself, and the page on your phone reloads once it's back on the new version. You stay signed in.
- On phones, the tabs on Applications show a space before their counts again ("Applied 0", not "Applied0").

## [2.34.1] - 2026-11-10

iPhone: Apple's guidelines, and phones held sideways.

### Changes

- On iPhone, every button, tab, menu item and checkbox is at least 44 points, as Apple's guidelines ask, so taps land where you mean them; a press dims the button so you can see it.
- The top bar is 44 points below the status bar, like an iOS navigation bar, and iOS no longer enlarges the text on its own when you turn the phone.
- On a phone held sideways (the iPhone Duo open on its side, say), Job Hunt keeps the phone layout: a slim bar on top and tabs at the bottom, instead of the menu filling a third of the screen. It also keeps clear of the camera at the side.
- No keyboard shortcut hints (Ctrl K) on touch screens.

## [2.34.0] - 2026-11-10

Self-updating extension, progress bar, Sonnet for searching.

### Changes

- The browser extension now lives in a folder Job Hunt keeps up to date (Settings → App shows it, with Copy and Open the folder). Load it from there once, and it reloads itself with each new version.
- The fill panel shows a progress bar while Claude writes your answers, with a running count of seconds, then fills to the end as the boxes are filled in.
- Searching uses one model throughout, Sonnet unless you change it: scoring, and also reading posting pages, Indeed, salaries, job titles and company ratings, which used the general model (Opus with an API key) before.
- Settings → Accounts shows which model does what: searching, CVs and cover letters, and everything else.

## [2.33.2] - 2026-11-06

Add no longer counts as Submit.

### Changes

- Job Hunt pressing a form's Add button (or you pressing Add, Delete, Next or Save and Continue) no longer counts as submitting the application, so the panel keeps showing that it's writing your answers instead of "Waiting for the site to confirm".
- If no answers come back within three minutes, the panel says so and Fill in this form works again.

## [2.33.1] - 2026-11-06

Add Another, fixed.

### Changes

- When a form needs more Work Experience or Education entries, Job Hunt now presses Add first and fills the whole form afterwards, so a redraw can't empty what it already typed.
- Only one Job Hunt panel works on a page at a time; a second copy no longer presses Add again or fills boxes the first one moved.
- Answers go to the boxes as they were when the form was read, even if the page changes while Claude writes them.

## [2.33.0] - 2026-11-06

Fills every job on your CV.

### Changes

- Application forms that show one work-experience or education entry until you press Add Another: Job Hunt presses it for each other job and school on your CV, then fills them all in, most recent first.

## [2.32.1] - 2026-11-06

Work history filled from your CV.

### Changes

- Job Hunt no longer saves or reuses work-history and education answers (Job Title, Company, From, Degree…): an old saved job title went into every form.
- Boxes the site had filled in already (its own CV reader) aren't painted green any more, and when they contradict your CV, such as a job title cut short, Job Hunt corrects them from your CV.
- Work Experience 1, 2, 3… (and Education 1, 2…) each get their own entry from your CV, most recent first, so jobs aren't mixed together or repeated.

## [2.32.0] - 2026-11-06

Opens in Edge.

### Changes

- Settings → App → Browser extension: choose Microsoft Edge (or Chrome) for the postings, company sites and forms Job Hunt opens, so your sign-ins, password manager and the extension are there.
- The Browser extension card in Settings → App has the download, your key with a Copy button, the steps for Edge, and shows Connected once the extension has reached Job Hunt.

## [2.31.1] - 2026-11-06

Fully remote counts, wherever it's based.

### Changes

- A fully remote role based in another city ("Ottawa, ON (Remote)") is kept, since you can work from home; it's left out only when its text ties you to that city: hybrid, office or on-site days, commuting, or having to live there. (Needs Include remote roles open across the country, in Search → What to search.)

## [2.31.0] - 2026-11-06

Fits any window.

### Changes

- Tabs that don't fit the window go into a More menu instead of out of sight, and each page's settings (Search's What to search and Set up sources, Inbox's and Calendar's Settings) are buttons at the top of the page, beside its main action.
- The Overview opens faster again: the employment type of each job was worked out on every visit (up to half a second with hundreds of jobs); now once per posting.
- Your minimum salary keeps every role whose range reaches it, and no longer cuts roles that state only a starting figure ("From $90,000", "$90,000+").
- Remote roles tied to a city that isn't yours ("Ottawa, ON (Remote)") are left out, like on-site ones there; "Remote - Ontario" and "Remote, Canada" still count. A source's results on the Search page show what Job Hunt kept; postings it skipped (outside your locations, say) are under Skipped.

## [2.30.0] - 2026-11-06

Scored while it searches.

### Changes

- Postings are scored as each job site returns them, while the rest are still being searched, instead of after the whole search: the first matches show up within minutes, and a search finishes sooner. The search's progress shows what's being scored meanwhile.

## [2.29.0] - 2026-11-06

Companies you've applied to before.

### Changes

- Fixed: Job Hunt 2.27 and 2.28 could freeze when opening (the Overview's "did these go through?" list waited on itself).
- Emailed applications look right in Gmail: real bullet points and bold themes, and the email starts at "Dear…" (the date, ATTN and Subject lines are for the printed letter).
- Job Hunt keeps track of companies you've sent a CV to: roles there are tagged Applied here before, and each job shows Your history with the company (the roles you applied for, and when) with your own notes.
- They keep every CV you send on file side by side, so for a company that has one already, tailoring stays close to it: the same headline, the same way of describing each achievement, and at most 4 paragraphs changed. Or choose the same CV as before, or tailoring as usual (Search → What to search → Tailoring).
- Before you approve, the CV & letter tab and Review show this CV beside the one you sent them, word by word, with Use the CV you sent before.

## [2.28.0] - 2026-11-06

See what changed.

### Changes

- After you ask for changes to a tailored CV or cover letter (or edit a paragraph yourself), the job's CV & letter tab, and Review, show What changed just now: each changed paragraph word by word, with what's gone struck through and what's new highlighted, and the changed paragraphs marked in the preview. Done clears it.

## [2.27.0] - 2026-11-06

Full-time or contract, at a glance.

### Changes

- A Type column in Applications shows each job's kind of employment, read from its title and posting: Full-time, Contract (with its length, like "Contract · 12 months"), Temporary, Part-time, Internship… Filter by it, sort by it; the Overview's lists show it under the salary.
- Jobs whose form Job Hunt filled in but that aren't marked applied (I submitted it could fail before this version) are listed at the top of Submit, asking whether they went through: Yes, applied for each, or All went through.

## [2.26.1] - 2026-11-06

Submitting in the Apply window, fixed.

### Changes

- Submitted an application in Job Hunt's Apply window and it wasn't marked applied? Fixed: the form's "Leave site?" guard could stop Job Hunt hearing about it (even the I submitted it button), and more sites' confirmations are recognised ("Thank you for your submission", "We've received your resume", a confirmation page's address), however the form was sent.
- Once it's marked applied, the window closes by itself (or the next one in Apply to all opens).
- Closed the window yourself after Job Hunt filled the form in? It asks whether your application went through, and marks it applied with one click.

## [2.26.0] - 2026-11-05

Updates by themselves, and a PC that stays on.

### Changes

- New option (Settings → App → Updates): Install updates by themselves. When a new version is out, Job Hunt installs it and restarts once nothing is running (no search, tailoring, email check or form filling) and you're not using its window, then tells you it updated.
- The PC stays on through a whole search, not just long enough to start one: Job Hunt now holds it awake for a few minutes after each step too, so it can't drop off between the search and the tailoring that follows (after a wake-up, Windows sleeps again after two idle minutes), and it uses Windows' power requests, which newer laptops with Modern Standby honour, so it keeps running with the screen off.
- If Windows sleeps during Job Hunt's work anyway (a closed lid, the power button), Settings → App says when and how to keep it on.
- The Overview drops its To do / All jobs switch: every job is on Applications, in the sidebar.

## [2.25.0] - 2026-11-05

Salaries found for your postings.

### Changes

- Job Hunt looks for the pay of every posting that doesn't show one: in its own text, on its page and the company's own posting, and, for pay written in ways its patterns miss, with Claude (which reads only the lines that mention pay, many postings at once). It runs once by itself after this update, then weekly; Look now (Search → What to search, under Minimum yearly salary) runs it any time.
- Fixed: salaries in LinkedIn, Job Bank and job sites' postings were missed, because Job Hunt looked for them before reading those postings' full text.
- A notice says how many it found, and which of the roles you're working on pay below your minimum.

## [2.24.0] - 2026-11-05

Salaries you can count on.

### Changes

- Changed your mind about a role you approved? Submit's list has a Not interested button (the ×), and so does the Apply window, which then goes on to the next one in the queue.
- Salaries are read more reliably: Claude reads the pay wherever the posting states it while scoring ("$95K to $110K", "up to", hourly), and Job Hunt also reads it from the company's own posting when it finds one, and from pages you open in the Apply window or with the extension.
- Pay below your minimum (Search → What to search) is tagged Below your minimum. A new posting found below it is set aside like the search filter would; one you've already tailored or approved gets a notice so you can drop it.

## [2.23.0] - 2026-11-05

Applying, faster.

### Changes

- Approve now opens the form straight away in Job Hunt's Apply window, filled in from your CV with your files attached. The Submit step's Apply to all goes through every approved role in a row: check each one, press Submit, and the next one opens (Skip leaves one for later).
- Your saved answers: when you submit a form, Job Hunt keeps your answers to the questions forms keep asking (work authorization, notice period, salary, how you heard about it) and fills them in next time without asking Claude. See and edit them in CV & Career → Your details.
- The company's own website comes first: a role still only on a job board is looked for on the company's site before its form opens, and the Approve and Submit lists say how each one is applied to (email, quick form, an account like Workday, or a job board), quickest first.
- Fill in forms in your own browser: the Send to Job Hunt extension (download it again) has Fill this form, using your sign-ins and saved passwords. Best for Workday, iCIMS and other sites with accounts. On a job board's copy of a posting, it offers the company's own site.
- Optional, off unless you turn it on (Your details → Submitting for you): Job Hunt submits simple Greenhouse, Lever and Ashby forms answered entirely from your saved answers, after a 10-second countdown you can stop. Never with a captcha or a box left for you to tick.

## [2.22.0] - 2026-11-05

Reaching out to recruiters, the right way.

### Changes

- Each job's People section says how to reach out for that kind of employer: private companies (message the recruiter within 1 to 3 days of applying), staffing agencies (yes, strongly), Government of Canada (skip outreach; focus on the screening questions) and provincial or municipal governments (one question at most).
- Messages to recruiters follow one short structure: the role and its job ID, one concrete line on your strongest proof, your availability or move (from your facts for forms), and an offer of a quick call. Never asking for the status, pasting your CV or mentioning attachments.
- Mark a message sent, and Job Hunt reminds you once if there's no reply in 7 to 10 days, writes the one follow-up, and then stops: never more than two messages to a person. It warns you before messaging a second person at the same company.
- The Overview's Waiting step lists roles you just applied to with "message the recruiter", and recruiters due their one follow-up. Automatic follow-up drafts skip government roles, and roles where you're already following up with the recruiter.

## [2.21.0] - 2026-11-05

Menus in the order you use them.

### Changes

- The sidebar follows a job hunt: Overview, Search, Applications, Inbox, Calendar, CV & Career, Results, Settings. On a phone, the bottom bar has Search in place of CVs (CVs are under More).
- Each page's own settings sit in a Settings tab at the right of its tabs: Search (What to search, Set up sources), Inbox (how often email is checked, follow-ups) and Calendar (time zone, interviews, reminders).
- Settings now has Accounts, Notifications (weekly review, phone notices), Sync & backup and App, and points to the settings kept on other pages.
- The spreadsheet of your applications downloads from the Applications page.

## [2.20.0] - 2026-11-05

Settings where they're used, and expired postings marked.

### Changes

- Search's settings are on the Search page now: What to search (places, roles to skip, schedule, tailoring) and Set up sources (keys, company boards, recruiters, the browser button).
- The email, interview and reminder settings are on the Calendar page, under Settings.
- Settings keeps Accounts, Sync & backup and App. Old links to the moved settings open them in their new place.
- Postings that are no longer open are marked Expired wherever they show: the Overview's steps (and moved to the bottom of the Pick list), All jobs, the job page, Review, Apply, the calendar, tailored files, search results and quick search. That covers ones the company took down and ones whose last day to apply has passed (those had no tag before).
- The job page, Review and Apply say why it expired, so you can check the posting before putting time in. Roles you've already applied to don't get the tag.

## [2.19.0] - 2026-11-04

Search has its own page.

### Changes

- Search is in the sidebar now. Its Sources tab lists every job source and recruiter with how it's doing, what it found last, and a Search button for searching it on its own.
- Each source that has found postings gets its own tab: every posting, its fit score, and whether it was new, already in Job Hunt, or skipped and why. Filter by outcome, and on Recruiters and job sites, by site.
- The daily search fills these tabs too, so you can see what each source brought in today, not only what you searched by hand.
- Search everything now, the search's progress, when the next one runs and how many postings wait to be scored are at the top. Keys and choices stay in Search → Set up sources.

## [2.18.0] - 2026-11-04

Search one source at a time.

### Changes

- Every job source on Search → Set up sources has a Search now button, and each recruiter or job site has its own Search: it searches just that source, for all your job titles, and shows every posting it found and what became of it: its fit score, already in Job Hunt, or skipped and why.
- New postings it finds are scored and go on your Overview like any search's; your daily search, its time and its report stay as they were.
- Last results opens a source's latest search again.

## [2.17.2] - 2026-11-03

A tidier All jobs table.

### Changes

- All jobs: the Next step column shows just its button (Tailor, Approve, Apply); what it means is in the button's tooltip. The table fits the window again.

## [2.17.1] - 2026-11-03

Pick counts that match what you see.

### Changes

- With Pick list filters on (like Shows pay), the Pick count and heading say how many you can see ("5 of 16"), with how many are hidden and a Show all button.

## [2.17.0] - 2026-11-03

Pause searches, more from recruiters, and less of your Claude plan.

### Changes

- Pause a search while it runs and resume it from the same step, or stop it. The search button shows what it's doing on hover, and on click the posting it's on and what it has found; it always agrees with the sidebar.
- Postings are scored with Sonnet by default (Settings, Connections, Advanced): nearly the same scores on much less of your plan. Tailoring stays on Opus.
- Postings a search couldn't get to are scored in small batches through the day, instead of waiting for tomorrow's search.
- Adecco, Altis Recruitment and Randstad are read through their own job searches, so they find postings again. Recruiters are searched around the area's main city (Toronto for the GTA), where they list their jobs. Aerotek, which lists US jobs only, is skipped for searches in Canada.
- Add a company by pasting its careers link: Job Hunt works out its job board (Greenhouse, Lever, Ashby, Workday and others).
- Click a company's rating on the Overview to see what its employees say, without leaving the page.
- Pick list: filter by when a role was found, and by fits under 60 or 70, to clear out old or weak matches in a few clicks.
- A Google sign-out shows one notice with a Reconnect button, instead of a message cut off mid-sentence.

## [2.16.0] - 2026-11-03

Progress bars.

### Changes

- Progress bars instead of spinners: each fills over the time that kind of work usually takes for you (scoring, tailoring, interview prep, career options…), learned from your own Claude requests, and searches show their real progress.

## [2.15.1] - 2026-11-03

Nothing lost when your CV changes.

### Changes

- Before an application is tailored again with a new CV, what it had is kept: Undo last CV change and Undo last letter change bring it back, so edits made before Job Hunt recorded them aren't lost.
- Removing your only CV no longer leaves its jobs stuck: they're scored and tailored again as soon as you add a CV.

## [2.15.0] - 2026-11-03

A new CV is used everywhere.

### Changes

- Replace or remove a CV and applications waiting for your approval are tailored again with your CVs as they are now: a new tailored CV and a new cover letter.
- Their fit is scored again first, so each one is tailored from the CV that fits it best, and jobs waiting to be picked get fits from the new CV too.
- Applications with your own file or your own edits keep them, with a note on each saying the CV changed. Ones you've approved or sent stay exactly as they went.

## [2.14.0] - 2026-11-03

Fit scores follow your CVs.

### Changes

- Removing a CV clears the fit it gave to jobs you haven't acted on, and scores them again against your other CVs. If it was your only CV, they wait unscored until you add one.
- Jobs you've already tailored, applied to or taken further keep their fit.
- Unscored jobs on the Overview have a Score it button, and sending an unscored job again from the browser scores it.

## [2.13.0] - 2026-11-03

Every role searched, update notices you'll see, and browser jobs to pick.

### Changes

- Every CV's job titles get searched: the CVs take turns instead of the first CV's titles filling every search, and each CV's top title is searched every day on every source, including Workday company boards.
- Broad titles are searched before the ones they already cover (Program Manager before Technical Program Manager), so each search finds more.
- LinkedIn, Job Bank and FreeHire run more searches each time, so more of your titles are covered every day.
- Postings a search finds but can't get to (over your scoring limit, or not read yet) are kept and scored first next time, instead of waiting to be found again. Postings whose title matches yours are scored before keyword-only matches.
- Updates: a bar across the top of every page when a new version is ready, a check whenever you open Job Hunt from the tray, a daily reminder until it's installed, and Install update in the tray menu.
- A job sent from the browser is scored and put on your Overview to pick, instead of being tailored straight away. Sending one that's already in Job Hunt says when its fit was scored.

## [2.12.0] - 2026-11-03

GTA searches, adding jobs without Claude, and lighter Claude use.

### Changes

- Oakville and the rest of the GTA are picked up however you write them ("Oakville, ON", "Oakville, Ontario"), including postings that name a district or region (Meadowvale, Peel Region, GTA) and remote roles open across Ontario.
- A GTA town you list, like Oakville, is searched around itself as well as around Toronto, so jobs west and east of the city aren't missed.
- Add a job without Claude: paste its link and Fill in from link reads the posting, then Just save it. Tailor it whenever you like.
- A job you add or send from the browser is saved instead of lost when Claude isn't connected or is at its usage limit.
- Uses less of your Claude plan for the same results: postings are sent without their legal boilerplate, emails without the quoted thread, LinkedIn job alerts are read without Claude, and browser postings are read from the page's own job data first.

## [2.11.0] - 2026-10-28

Career coach, pause searches, and a clearer job page.

### Changes

- Stop a search while it runs, or pause the daily search for a day, a few days or a couple of weeks, or turn it off: from the Daily search menu at the top of the Overview, or in Settings.
- New Career coach tab in CV & Career: the skills the roles you go for ask for that your CV doesn't show, the hard requirements you missed, and a plan from Claude for closing each gap.
- Every week the coach suggests new job titles to try; add one to your search with a click from the Overview.
- All your job titles get searched: sources that run only a few searches now take turns through the rest, a different few each day.
- The job page puts progress and stage front and centre, shows the full posting, and puts the company rating on the right.
- Applications is back in the left menu, Recent activity is open by default, and the Tailored files and Career paths tables line up and sort by any column.
- Skip companies rated below a score you choose (Settings, Which roles).
- Fill it in for me keeps working when an Apply button opens a new window.

## [2.10.0] - 2026-10-28

Your own CV, applications you send yourself, and All jobs filters.

### Changes

- Attach a CV you tailored yourself to any job: it moves to Approve, shows in the preview (PDFs too) and is the one used when you apply.
- Applications you send yourself are picked up from the confirmation email, archived or not, even for jobs Job Hunt didn't find, and labelled JobHunt/Applied in Gmail.
- All jobs: filter by stage, fit, source, date and pay, and sort; nothing is cut off on the right.
- Approve and View open the full job page, and every button on a job is in view again.
- Cards line up, including Recent activity.

## [2.9.1] - 2026-10-28

Quieter searches and safer updates.

### Changes

- The windows that read job sites during a search stay off-screen and never take your mouse or keyboard.
- Install and restart waits for a running search or tailoring to finish.
- The screening-software check lists everything it checked.

## [2.9.0] - 2026-10-28

Faster picking and approving.

### Changes

- Pick and Approve: a job opens beside the list (wide screens), with j / k to move through it.
- Tick several jobs and act on them from the bar at the bottom.
- Each job shows one main button and only the tabs its stage needs.
- Why it fits, the biggest gap and anything required up top on every job.
- Calmer lists, a Find a job box, and Results by 7, 30 or 90 days with reply rate by source.

## [2.8.0] - 2026-10-28

FreeHire, the big Canadian employers, and Ask Claude.

### Changes

- FreeHire: a free job search with full postings, mostly linking to employers' own sites.
- Ontario Teachers', HOOPP, OMERS, RBC, TD, CIBC, BMO, Manulife and Sun Life's careers sites are searched directly (in Canada).
- Companies on BambooHR can be added as careers sites.
- Ask Claude: a conversation on each job that knows the posting, your CV and your notes.
- Know when your CV links are opened (needs Job Hunt at a public address).
- Results shows how much your job sources overlap, and what only each one finds.
- Ctrl+K finds any job; press ? for every key.

## [2.7.0] - 2026-10-28

Referrals, browser extension and bulk approve.

### Changes

- Jobs from recruiters' job-alert emails (Randstad, Adecco, Hays, Robert Half, Michael Page and more).
- The same job on several sites is kept once, and you apply on the company's own site.
- A Stretch badge when a posting requires something your CV doesn't show.
- Approve several applications at once.
- Add your LinkedIn connections to see who you know at each company and ask them for a referral.
- Send to Job Hunt as a Chrome or Edge extension.
- Results opens with your week in plain words.
- Fit reasons are one short line.
- Matches not picked in 60 days are set aside.
- Job Bank is on by default in Canada.

## [2.6.0] - 2026-10-28

Your files in Documents, All jobs as one table.

### Changes

- Your CVs, tailored CVs and cover letters, and backups are kept in a folder you choose: Documents\Job Hunt for new installs, or any folder in setup or Settings → Sync & backup → Your files. Moving takes the files along.
- All jobs is one table of every job (applications, new postings and skipped ones): click any column's heading to sort by it. The Board is gone (the steps are the board), and tailored files moved to CV & Career → Tailored files.
- The company comes first, then the role, in every list.
- LinkedIn and other job board postings you tailor are found on the company's own site by themselves, so Apply goes straight to the company.
- Tailored files are found again after continuing on another computer.

## [2.5.0] - 2026-10-27

To do or All jobs.

### Changes

- The Overview has a switch: To do shows your steps, All jobs shows the Tracker, Board, Documents, All postings and Skipped.
- Pick is one list you can sort (fit, fit after tailoring, newest, pay, company rating) and filter (minimum fit, place or remote, shows pay, no red flags).
- The Tracker shows the company first, and its rows line up.
- Testing a job source shows a progress bar.

## [2.4.0] - 2026-10-27

Everything on the Overview.

### Changes

- Applications moved into the Overview: the steps of your job hunt are tabs across the top (Pick, Approve, Submit, Waiting, Interviews) with how many are in each, and it opens on your next step.
- Each step shows its roles with the next thing to do; the Tracker, Board, Documents, All postings and Skipped are a second row of tabs on the same page.
- On a phone, the bottom bar shows CVs where Applications was.

## [2.3.1] - 2026-10-27

Every place gets searched.

### Changes

- Each job title is now searched in all your places before the next title, so cities after your first (Halifax, for one) are searched by every job site, not only Adzuna.
- Indeed searches all your places, not only the first.
- The Halifax area (Dartmouth, Bedford, Sackville, Cole Harbour) counts as Halifax when nearby places are included.
- Tailored files are named simply "Your Name - Company.docx" and "Your Name - Company - Cover Letter.docx".
- When Google signs Job Hunt out, it says why that usually happens (a Google project in Testing signs out every 7 days) and how to stop it.
- Google Drive keeps only your last three daily backups (named by date); the older ones, and the weekday ones from before, are deleted.
- Needs attention no longer shows a problem that's already fixed: an error goes away once the same task works again, or once you reconnect Google.

## [2.3.0] - 2026-10-27

Recruiter sites work again.

### Changes

- Michael Page, Hays, Adecco, Altis and Robert Half moved their job searches; Job Hunt follows them.
- Sites that check for a real browser or build their lists with scripts (Robert Half, Randstad, Adecco, Hays, Altis, People First HR, Jobs.ca, Tech Talent Canada) are read in a hidden browser window in the Windows app, and LRO Staffing, whose connection the app couldn't open, is read there too.
- The CIPS job board is now for members only, so it's no longer offered.

## [2.2.0] - 2026-10-27

Salary and why-it-fits columns.

### Changes

- The to-do list shows salary and why it fits in their own columns; click the reason to see all of it and the red flags.
- Fit reasons are now one short line: the strongest match, then the biggest gap.
- Tailor selected and Select all sit above the roles to pick.

## [2.1.0] - 2026-10-27

The previous look is back.

### Changes

- The look from before 2.0 is back: the dark blue side menu and blue buttons.
- The fit after tailoring is a second score badge next to the first; before tailoring, the predicted fit is the same badge with a dashed outline.
- Long place lists show the place nearest you with "+3 more", and remote roles read "Toronto (remote)" or "Remote (US)". Hover for the full list.
- The to-do list lines up: fit, role, company, place and buttons sit in the same columns in every group, with the same buttons.

## [2.0.1] - 2026-10-27

The Job Hunt logo on your Send to Job Hunt button.

### Changes

- Send to Job Hunt now gets the Job Hunt logo as its icon in your bookmarks bar: in Search → Set up sources, press Set up the button and follow the three steps on the page that opens. (Added it before? Do this once to replace it.)

## [2.0.0] - 2026-10-27

Job Hunt 2: a calmer look, Drive backup on by default, clearer sources.

### Changes

- A new look: a light, calm layout with soft panels, no clutter of small capitals and shadows, one dark button for the main thing on each screen, and colour kept for what matters (fit, ratings, problems). A true dark mode.
- The Overview opens with your greeting and what's waiting on you today, then your four numbers, your to-do list, and a short Last search: "From 16 sources · 6 didn't work", with the details one click away.
- Company and location have their own columns in every list: All postings, Skipped, the Tracker, Documents and the Overview.
- Connecting Google now keeps your data synced and backed up in your own Google Drive straight away. On a new PC, install Job Hunt, connect the same Google account on the Welcome page, and it offers to continue where you left off. Already connected? One click: Turn on.
- Recruiters and job sites that can't be read now show as Some not working (never Working), with a button to turn off the ones that don't work.
- Fit forecasts are filled in for postings found before forecasts existed, and show on the Overview.
- Company ratings: more companies get one (broader searches, retried sooner, one failure no longer stops the rest).
- Indeed through your Claude account: Job Hunt now lets Claude Code look up the Indeed tools when your account has several connectors, waits longer for connectors to start, and tries once more before reporting a problem.
- The Send to Job Hunt bookmark has a briefcase icon in your bookmarks bar (add it again to get it), with a Copy the name button.
- A posting you send twice is noted on the job that's there (and is clickable in Recent activity), not shown as a problem.
- Fix: Google could still say to reconnect after you'd connected, from a test made before.

## [1.45.0] - 2026-10-27

Company ratings from employee reviews.

### Changes

- What employees say about each company: the rating out of 5 and number of reviews from Glassdoor, Indeed and similar sites, work-life balance, the share who'd recommend it, and what reviewers praise and complain about. It shows as ★ 4.1 next to the company on the Overview, in your lists and on each job, with the details in a "What employees say" card on the job's Overview.
- Job Hunt looks companies up by itself for roles you're considering, a few at a time, once per company (again after two months), through Claude Code. On a job, Look up reviews or Look again asks now. Turn it off in Settings → Search → Employers.

## [1.44.0] - 2026-10-27

Settings that make sense, Drive sync you can see, and a fit forecast.

### Changes

- Settings are reorganised into six clear tabs: Accounts, Search, Job sources, Email & calendar, Sync & backup, and App. Each setting sits where you'd look for it: the daily search time with Search, your time zone and phone notices with Email & calendar, the browser button with Job sources.
- CV & Career has three tabs: Your CVs, Career paths, and Your details (name, email, signature, stories and answers for application forms).
- The side menu is down to seven places: Overview, CV & Career, Applications, Calendar, Inbox, Results and Settings. Documents is now a tab in Applications (next to Tracker, Board, All postings and Skipped), Add a job is the button at the top of Applications, and Recruiters is a tab in Inbox next to your job email. Old links still work.
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
- Career paths now show the usual hours a week and the work-life balance of each role (good, mixed or demanding, and why: on-call, travel, busy seasons, remote), so you can weigh pay against time. Press Think again on CV & Career to add them.

## [1.42.2] - 2026-10-21

CV & Career up front, and senior roles searched too.

### Changes

- Fix: Indeed through your Claude account didn't work even when connected: Job Hunt started Claude Code with every tool switched off, which also hid your claude.ai connectors. It now refuses only the risky built-in tools by name.
- When Indeed (through your Claude account) doesn't work, Job Hunt now checks why and says so: Claude Code signed in with a token or API key, the connector not connected, or just not answering this time. Source tests say they try one sample title; real searches use all of them.
- Career paths help you choose a direction, not just your next job: each path shows where it leads now and in 3, 5 and 10 years, with the title and pay at each step, the top of the path and the most it can pay. A table compares the paths side by side, and Claude's advice weighs where they lead. Its job titles (to add to your search) are folded away under Look for this role now, with the CV they go to labelled.
- CV & Career has its own place in the menu, second after Overview: your CVs, the experience Claude found, the job titles they search for, and your career options, all in one page. It used to be a tab inside Settings.
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

[2.65.6]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.65.6
[2.65.5]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.65.5
[2.65.4]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.65.4
[2.65.3]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.65.3
[2.65.2]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.65.2
[2.65.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.65.1
[2.65.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.65.0
[2.64.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.64.0
[2.63.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.63.0
[2.62.2]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.62.2
[2.62.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.62.1
[2.62.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.62.0
[2.61.2]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.61.2
[2.61.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.61.1
[2.61.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.61.0
[2.60.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.60.0
[2.59.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.59.0
[2.58.2]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.58.2
[2.58.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.58.1
[2.58.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.58.0
[2.57.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.57.0
[2.56.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.56.1
[2.56.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.56.0
[2.55.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.55.0
[2.54.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.54.0
[2.53.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.53.0
[2.52.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.52.1
[2.52.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.52.0
[2.51.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.51.1
[2.51.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.51.0
[2.50.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.50.1
[2.50.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.50.0
[2.49.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.49.0
[2.48.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.48.0
[2.47.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.47.0
[2.46.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.46.1
[2.46.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.46.0
[2.45.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.45.0
[2.44.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.44.1
[2.44.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.44.0
[2.43.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.43.0
[2.42.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.42.0
[2.41.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.41.0
[2.40.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.40.0
[2.39.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.39.0
[2.38.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.38.0
[2.37.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.37.0
[2.36.9]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.36.9
[2.36.8]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.36.8
[2.36.7]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.36.7
[2.36.6]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.36.6
[2.36.5]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.36.5
[2.36.4]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.36.4
[2.36.3]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.36.3
[2.36.2]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.36.2
[2.36.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.36.1
[2.36.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.36.0
[2.35.14]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.35.14
[2.35.13]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.35.13
[2.35.12]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.35.12
[2.35.11]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.35.11
[2.35.10]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.35.10
[2.35.9]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.35.9
[2.35.8]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.35.8
[2.35.7]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.35.7
[2.35.6]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.35.6
[2.35.5]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.35.5
[2.35.4]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.35.4
[2.35.3]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.35.3
[2.35.2]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.35.2
[2.35.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.35.1
[2.35.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.35.0
[2.34.5]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.34.5
[2.34.4]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.34.4
[2.34.3]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.34.3
[2.34.2]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.34.2
[2.34.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.34.1
[2.34.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.34.0
[2.33.2]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.33.2
[2.33.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.33.1
[2.33.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.33.0
[2.32.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.32.1
[2.32.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.32.0
[2.31.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.31.1
[2.31.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.31.0
[2.30.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.30.0
[2.29.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.29.0
[2.28.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.28.0
[2.27.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.27.0
[2.26.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.26.1
[2.26.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.26.0
[2.25.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.25.0
[2.24.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.24.0
[2.23.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.23.0
[2.22.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.22.0
[2.21.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.21.0
[2.20.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.20.0
[2.19.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.19.0
[2.18.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.18.0
[2.17.2]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.17.2
[2.17.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.17.1
[2.17.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.17.0
[2.16.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.16.0
[2.15.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.15.1
[2.15.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.15.0
[2.14.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.14.0
[2.13.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.13.0
[2.12.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.12.0
[2.11.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.11.0
[2.10.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.10.0
[2.9.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.9.1
[2.9.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.9.0
[2.8.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.8.0
[2.7.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.7.0
[2.6.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.6.0
[2.5.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.5.0
[2.4.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.4.0
[2.3.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.3.1
[2.3.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.3.0
[2.2.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.2.0
[2.1.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.1.0
[2.0.1]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.0.1
[2.0.0]: https://github.com/hisXLNC/job-hunt-releases/releases/tag/v2.0.0
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
