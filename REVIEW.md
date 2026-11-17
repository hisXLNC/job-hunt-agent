# Code review, 17 November 2026 (at 2.97.3)

Seven reviewers read every source file; nothing was run. Each line: where, what goes wrong, and
a status. **Status**: `fixed X` (released in X), `open` (believed real, not fixed yet),
`unverified` (plausible, needs a check in the real app), `decide` (needs the owner's decision).
Line numbers are as of 2.97.3.

## A. Safety of your data and your PC

1. `desktop/src-tauri/src/lib.rs:986`, `core/src/api.rs:261`: the app's own address answers every
   window, not only the main one, so a job site open in the Apply or reader window may be able to
   call the app (change settings, send the other-AI key elsewhere, restore a backup). unverified
2. `api.rs:2101`, `api.rs:1764`, `backup.rs:210`: over Remote access, restoring a backup and
   setting the backup folder are not refused; a crafted backup can plant a program the app later
   runs. open
3. `bridge.rs:124`, `fill.js:12`: the phone bookmark leaves the key readable by the page it runs
   on; that page can then ask for your CV and answers. open
4. `fill.js:7,121`, `lib.rs:581`: in the Apply window a hostile page can read the token and mark a
   job applied or change saved answers. open
5. `claude_code.rs:537`: Claude driving the browser may Read any file on the PC; a page could try
   to talk it into reading one. open
6. `claude_code.rs:399`, `claude.rs:2283,2633`: web look-ups carry your CV and can fetch any
   address; posting text could try to send the CV out. open
7. `claude_code.rs:403`: Indeed requests leave your other Claude connectors and settings active. open
8. `fill.rs:1036,1740`: box labels from the page sit among the instructions given to Claude. open
9. `backup.rs:14,63`: a backup "without sign-ins" still holds the other-AI key, the extension key
   and the phone topic; deleted values can remain in the file. open
10. `web.rs:33`, `sync.rs:330`: the remote password is weakly hashed and travels in the sync copy. open
11. `web.rs:224`: a device on your network can dodge the wrong-password lockout. open
12. `bridge.rs:80`, `web.rs:136,272`: large or endless requests are read before the key is checked. open
13. `sources.rs:786,1013`: a failing Jooble or Adzuna search can show its key in the error text. unverified
14. `claude.rs:2029`: the other-AI address is not checked for https at the point of use. open
15. `claude_code.rs:599`: copies of CVs stay in the temp folder after a crash. open
16. `fill.js:1934`: answers stay in the tab after a submit that wasn't confirmed. unverified
17. `app.js:249`: one posting link is a plain link, not routed through the checked opener. open
18. `app-ask.js:207`: some of Claude's offer buttons (approve, mark applied, fill) act on one click. fixed 2.99.0 (approve, mark applied and fill ask first)

## B. Wrong outcomes (jobs, applications, email)

19. `lifecycle.rs:116` with `pipeline.rs:928,940`: two locks taken in opposite orders; a job page
    refresh meeting the start of any work can freeze the whole app. fixed 2.98.0
20. `filters.rs:64`: a skip word matches inside other words ("intern" hides "Internal Audit
    Manager", "International Tax Manager"). fixed 2.98.0
21. `sources.rs:351`: any letter k nearby multiplies a small number by 1,000 ("$50 weekly lunch
    credit" reads as 50,000). fixed 2.98.0
22. `sources.rs:330`: relocation, tuition, stipend, referral and similar amounts read as the pay. fixed 2.98.0
23. `sources.rs:442,1749`, `sites.rs:246`: hourly, monthly or weekly pay from Lever, FreeHire and
    page data treated as yearly. fixed 2.98.0
24. `sources.rs:191`: currency codes match inside words ("European", "audience"). fixed 2.98.0
25. `sources.rs:505`: Adzuna's estimated salary used as the real one. fixed 2.98.0
26. `app-pipeline.js:196`: on the screens, monthly pay reads as yearly and "401k" as 401,000. open
27. `sources.rs:112`: the "apply by email" address can be the accommodation or privacy mailbox;
    approving then emails your CV there. fixed 2.98.0
28. `recruiters.rs:493,149`: the same mailboxes can be taken for a recruiter and written to. fixed 2.98.0
29. `recruiters.rs:485`: the recruiter note can go to the address the application went to. open
30. `fill.js:1970`, `fill.rs:1228`: pressing Submit can mark the job applied when the site refused
    the form. open
31. `fill.rs:470`: a page is matched to a job by the first word of a company name anywhere in the
    page ("Bank" of Montreal on National Bank's form): the wrong CV is uploaded. fixed 2.98.0
32. `fill.rs:485`, `db.rs:288`: two jobs at one company: the first is used silently; Greenhouse
    embed forms all share one key. open
33. `fill.js:461,1197`: a plain "Skills" text box is treated as a search list; a real Enter can
    submit the form. open
34. `fill.js:1678`, `fill.rs:620,806`: auto-submit can press the wrong button, and decides by the
    saved link's site, not the page's. open
35. `fill.js:1482`: answers shift by one box when the page changes while Claude is writing. open
36. `fill.js:760,876`: "No" can pick "Non-binary"; a tick-box answer also ticks a longer option
    that starts the same. open
37. `fill.rs:169,347`: a referee's email saved under "Email" fills your own email next time. open
38. `fill.rs:560`, `fill.js:1794`: "Resume and cover letter" box gets only the letter. open
39. `fill.js:783,824`: "(.pdf, .docx)" hint read as an attached file; Replace can press other
    Remove buttons. unverified
40. `fill.js:590`: a dropdown that ignored the click shows as filled. open
41. `fill.js:320`: hidden trap boxes are filled, which can flag you as a bot. unverified
42. `fill.js:1431`: a box that timed out keeps typing while later boxes are filled. unverified
43. `fill.js:1478`, `bridge.rs:354`: a remembered job from an earlier form in the same tab can be
    marked applied. unverified
44. `fill.rs:1730`, `fill.js:248`: a take-over that never ran reports "finished"; can show another
    job's result. unverified
45. `fill.js:921`, `fill.rs:598`: on profile sites, picking from a list skips a job on your CV. open
46. `mail.rs:67`: one email that fails stalls the inbox and is read again (one Claude call) at
    every check. fixed 2.98.0
47. `mail.rs:56`: an email Claude can't sort is tried again at every check. fixed 2.98.0
48. `pipeline.rs:3622,4117`: a failing search or email check retries every minute, with a notice
    each time. fixed 2.98.0
49. `pipeline.rs:1651`, `search.rs:471`: a job-alert email counts as the day's search, so the full
    search doesn't run. fixed 2.98.0
50. `pipeline.rs:1607`: alert emails marked read before their postings are kept; an error loses
    them. open
51. `search.rs:74`: after a stopped search, "Score them all now" does nothing. fixed 2.98.0
52. `pipeline.rs:1502`: over 400 waiting postings, real candidates are dropped and near-misses
    kept. open
53. `pipeline.rs:1558`, `search.rs:317`: waiting postings are lost if a search is stopped or fails
    part-way. open
54. `pipeline.rs:2017`: the daily "still open?" check looks at the same 80 queued jobs and never
    at tailored or approved ones. fixed 2.98.0
55. `pipeline.rs:1978`: a posting found closed can demote a job you tailored in the meantime. fixed 2.98.0
56. `pipeline.rs:2301`: switching back from your own CV file leaves the job "ready" with no CV. open
57. `pipeline.rs:475,939`: Stop on a tailoring started from "Tailor picked" does nothing. open
58. `pipeline.rs:3482`: a double click on Approve can email the application twice. fixed 2.98.0
59. `tailoring.rs:468,493`: a CV update can re-tailor and overwrite an application you sent
    meanwhile. fixed 2.98.0
60. `tailoring.rs:585,1318`, `search.rs:924`: re-scoring can move an applied job back to the
    Queue. fixed 2.98.0
61. `tailoring.rs:358`: a stopped CV update restarts by itself and redoes everything. open
62. `tailoring.rs:1227`: a job you chose with "Tailor anyway" is set aside by the salary or
    permanent/contract button. fixed 2.98.0
63. `tailoring.rs:1211`, `search.rs:883`: jobs Claude set aside for pay ("Pays up to …") never
    come back when you lower the minimum. fixed 2.98.0
64. `tailoring.rs:1287`: bring-back scoring can fail silently if a re-score is already running,
    and has no cap. fixed 2.99.1 (it waits for the other scoring; still no cap)
65. `tailoring.rs:1238`: the "already re-scored" list never clears. open
66. `tailoring.rs:350`: a letter you edited can be overwritten by a held re-tailoring. open
67. `tailoring.rs:757`: the after-tailoring score is rarely retried after a failure. open
68. `pipeline.rs:2781`: an old unmatched rejection can later land on the wrong application; with
    one application at a company there is no role check. open
69. `mail.rs:183`: an email can move an offer back to interviewing, or reject a job not yet sent. fixed 2.98.0
70. `mail.rs:303`: a rescheduled interview leaves the old one on the calendar. open
71. `search.rs:813`: postings never read count as "tried" and are filed as unreadable. open
72. `search.rs:1245`: a job you added by hand can be set aside by the location filter. fixed 2.98.0
73. `search.rs:1173`: a low-scored job sent again from the browser is not looked at again. open
74. `db.rs:750`: on every start, two same-titled jobs with different requisition numbers are
    merged, then found and scored again. fixed 2.98.0
75. `sources.rs:376`: "31 Oct 2026" is read as Oct 20. fixed 2.98.0
76. `sources.rs:34`: "jobs.ca" matches jobs.canadiantire.ca, so real employer links are treated
    as job boards. fixed 2.98.0
77. `sources.rs:125,513`: "Remote Sensing Analyst" and "not a remote position" count as remote. fixed 2.98.0
78. `sources.rs:223`: the shown employment type says Contract for "Contract Manager". open
79. `sources.rs:873,1024`: a failure on a later page throws away the earlier pages. open
80. `sources.rs:421`: Greenhouse "posted" uses the last-edited date. open
81. `sites.rs:257`: two postings whose links contain "2026" get the same id; one is dropped. open
82. `filters.rs:140`: "Contract and Procurement Manager" read as a contract role. fixed 2.98.0
83. `filters.rs:15`: "TPM" and "PM" both become "manager". fixed 2.99.0 (spelled out)
84. `filters.rs:44`: an 8-digit date would be read as 1970. open
85. `usage.rs:155`, `pipeline.rs:783`: the usage-limit pause is never cleared when you switch to
    another AI or a key. fixed 2.98.0
86. `claude_code.rs:482`: ordinary errors containing "limit" pause everything for an hour. fixed 2.98.0
87. `claude_code.rs:543`: "Fill with Claude" is missing from usage, and a limit hit there isn't
    noticed. open
88. `claude_code.rs:243`: Stop or a timeout leaves helper processes running. unverified
89. `claude_code.rs:435`: extra output around the answer makes a paid answer fail. unverified
90. `claude_code.rs:207`: Settings shows "force-stopped" for 8 seconds after Stop. open
91. `claude.rs:1957`: a timed-out request is sent again up to twice (up to three times the cost). open
92. `claude.rs:384,2135`: posting text can imitate the markers between postings scored together. open
93. `claude.rs:1981`, `usage.rs:23`: cost shows 0 for the API and other-AI engines. open
94. `cv.rs:437,585`: a figure ending a sentence ("$500,000.") isn't recognised, so a valid edit
    using it is refused. fixed 2.98.0
95. `cv.rs:489`: a rebuilt paragraph loses links and inline pictures. open
96. `util.rs:89`: control characters in text can make Word refuse the file. fixed 2.98.0
97. `tailoring.rs:636`: a company called CON or a very long name makes a file that can't be saved. open
98. `leads.rs:73`: over 300 leads, ones you wrote to can be deleted. open
99. `leads.rs:192`: "Mark Chen" is given marketing@. open
100. `leads.rs:318,265,283`: changes made while Claude works on leads are overwritten. open
101. `leads.rs:305`: two posts differing only after "?" count as one. open
102. `leads.rs:313`: "CTO @ Acme" isn't read; "at scaling startups" is. open
103. `recruiters.rs:112`: your own quoted signature can be saved as the recruiter's details. unverified
104. `recruiters.rs:131,422`: a recruiter at "Delta" matches "Delta Air Lines"; guessed boards
     can be another company's. open
105. `google.rs:760`: a calendar that can't be read counts as free. unverified
106. `google.rs:212`: sign-in can hang on a stray connection. unverified
107. `google.rs:531`: a reply to a name with accents can get a broken address. unverified
108. `backup.rs:204`, `lib.rs:1001`: a restore that fails half-way leaves an empty app, silently,
     on every start. open
109. `backup.rs:192`: restoring an ordinary backup removes every sign-in. fixed 2.99.0 (this PC's are kept)
110. `sync.rs:301,316,334`: sync orders copies by each computer's clock; changes made during the
     copy count as synced; the copy and its label can arrive mismatched. open
111. `web.rs:165`, `api.rs:443`: a job whose id contains "/" can't be opened. unverified
112. `mcp.rs:79,102`: work started from Claude Desktop dies when it closes; an empty company
     matches any question. open
113. `db.rs:716,771,793`: deleting a job leaves its history rows; not done in one step. open
114. `lib.rs:997,1104`: if the app can't start (locked or damaged database) it exits with no
     message. open
115. `people.rs:81,95,148`: the recruiter queue can lose an entry; a dismissed job is still
     looked up; third failure drops it for good. open
116. `pipeline.rs:2843,3291`: one follow-up or forecast that always fails blocks the rest. open
117. `pipeline.rs:2689,4336`: times compared as text across time zones (a second thank-you). unverified
118. `pipeline.rs:1720`: a notice says "Searching them now" when nothing searches. open
119. `pipeline.rs:3736,3687`: the digest waits for the later of two search hours. open

## C. Screens

120. `app-job.js:347`: the job page redraws every 4 s while work runs and wipes what you type. fixed 2.98.0
121. `app-steps.js:419`: when scoring ends the Queue redraws and clears your ticks. fixed 2.98.0
122. `app-settings.js:1568`: editing two forms within a second saves only one, and still says
     saved. fixed 2.98.0
123. `app.js:119`: in a dialog, Enter always presses the main button, even with Cancel focused. fixed 2.98.0
124. `app-steps.js:591`, `app-settings.js:1146,1196`: the Queue's "Sort by" is ignored after a
     header sort; "Recommended order" does nothing. open
125. `app-pipeline.js:91`: on All jobs a filter change resets a header sort. open
126. `app-steps.js:257`: Follow up shows 6 of 14 and the rest appear nowhere. fixed 2.98.0
127. `app.js:478`: "Closes tomorrow" on the last day before noon. fixed 2.98.0
128. `app-calendar.js:328`, `app-settings.js:821`: date-only values show the previous day. fixed 2.98.0
129. `app-settings.js:1031`: clearing a number box saves 0. fixed 2.98.0
130. `app.js:652`: ticking a filter stops the page refreshing. fixed 2.98.0
131. `app-settings.js:1753`: Escape on a job page goes back even when it just closed a menu. open
132. `app-leads.js:93`: refresh timers pile up on Leads. fixed 2.98.0
133. `app-actions.js:1261`: Settings redraws every 3 s while Google connects. open
134. `app-steps.js:209`: "Found: last 3 days" filters by posted date. open
135. `app-actions.js:757` and others: Copy buttons fail on the phone. open
136. `app-settings.js:1741`: the "/" shortcut does nothing on All jobs and People. open
137. `app-ask.js:170`: the Ask log redraws each second and collapses what you opened. open
138. `app-pipeline.js:90`: "1 jobs". fixed 2.98.0
139. `app-steps.js:574`: sorting a number column upward puts empty rows first. open
140. `app.js:748,764`: a "%" in the address or a company name breaks the page. open
141. `app-queue.js:338,88`: storage blocked breaks the Queue; two interviews share one id. open
142. `app-pipeline.js:56`: "&" shows as "&amp;" in a tooltip. open
143. `app-pipeline.js:48`, `app.js:108`: table rows and dialogs can't be used by keyboard alone. open
144. Unused handlers: `applied`, `copyText`, `moreMenu`, `sitesOff`, `welcomeRecheck`. open

## D. Release tools

145. `release_ci.py:334,349`: a hand-written entry without "changes" passes the check, then
     publishing fails after the build. open
146. `.githooks/pre-push`: checks the files on disk, not the commit being pushed. open
147. `release_ci.py:248`: a missing test file counts as "skipped". open
148. `build.yml:155`: re-running an older build could publish it as the latest. open

## E. Speed (the database is large)

149. `pipeline.rs:3651-3703`: four whole-table reads every minute when there is nothing to do. open
150. `api.rs:675,703`: All jobs loads every posting's full text and re-reads pay and deadlines
     each time. open
151. `api.rs:334`: Settings holds the database while it opens every CV; 23 screens ask for it. open
152. `api.rs:517`, `pipeline.rs:1285`, `tailoring.rs:1228`, `people.rs:313`, `mcp.rs:99`: full
     rows loaded where a count or a few columns would do. open
153. `db.rs:277`: bookkeeping writes make a sync due and clear the Overview cache. open

## F. Larger opportunities

- One pay reader (amount, period, currency) with a table of test strings, in place of four.
- One "may I redraw?" gate for every timer on the screens; keep focus, ticks and open sections.
- One sort state for the Queue (headers and menu) and for All jobs.
- Waiting postings in their own table instead of one saved list (fixes 52, 53).
- Leads as rows, not one saved list (fixes 98, 100).
- A table-driven test that every address the screens call is answered (the 2.97.3 bug).
- Shared retry with back-off for job boards; pause screen polling while the window is hidden.
