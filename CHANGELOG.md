# What changed

The newest version is first. The release build publishes the top section as the release's notes.

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
