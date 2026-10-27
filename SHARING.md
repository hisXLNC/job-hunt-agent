# Sharing Job Hunt, and using it on any computer

Each person who installs Job Hunt gets their own copy: their own CVs, applications, Claude, Gmail, Calendar
and Google Drive. Nothing is shared between people. One person can use Job Hunt on several computers (and
on a server, see [server/ORACLE.md](server/ORACLE.md)) by syncing through their own Google Drive.

## Once: build Google into Job Hunt

Follow [GOOGLE-SETUP.md](GOOGLE-SETUP.md) (about 15 minutes, once). After that, everyone who installs
Job Hunt connects Gmail, Calendar and Drive with one button. Until then, send friends the connection
file from that guide; they choose it in Settings → Accounts.

## Giving Job Hunt to a friend

Send them two links: the installer
(`https://github.com/hisXLNC/job-hunt-releases/releases/latest`) and
[GETTING-STARTED.md](GETTING-STARTED.md), which walks them through it in plain steps. In short:

1. They install it and open it. The **Welcome** page takes them through the rest.
2. **Claude:** one button installs Claude Code and signs them in with *their* Claude account, in their
   browser. Job Hunt uses their Claude plan, not yours. (Or they paste their own Claude API key.)
3. **Their CV(s)**, their locations, and where to look.
4. **Google:** **Connect Google**, signing in with *their* Google account. Google warns that it hasn't
   verified the app: they click **Advanced → Go to Job Hunt**. If you kept the Google project in
   *Testing* (see GOOGLE-SETUP.md step 3), add their Gmail address as a test user first, or Google says they don't have
   access.
5. Optional: Settings → Sync & backup → **Sync to Google Drive → Straight to Google Drive**, so they can use other
   computers too.

They get updates automatically, like you. Their data stays on their computer and in their own Google Drive.

## Using your own Job Hunt on another computer

1. On the computer you use now: Settings → Sync & backup → **Sync to Google Drive** → **Straight to Google Drive**,
   tick *Keep it up to date* and *Include saved keys and sign-ins*, **Save**. (Connect Google first, and
   reconnect it once if it was connected before Drive was added.)
2. On the other computer: install Job Hunt. On the Welcome page, under *Already using Job Hunt on another
   computer?*, press **Connect Google** and sign in with the same account. Job Hunt finds your data in
   Drive and offers **Continue from …**; it restarts with everything.
3. Claude Code is per computer: install it and sign in there too (or your API key comes along with your
   saved sign-ins).
4. Use one computer at a time. If you open Job Hunt on a second one while the first is still on, it says so
   and offers to **take over**: the first saves its latest data and stops, and this one continues from it.
