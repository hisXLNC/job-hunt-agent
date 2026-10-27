# Job Hunt on Oracle Cloud (free)

> **This is the technical way.** It needs typing commands on a cloud computer and takes about an hour. If
> you're not comfortable with that, ask someone who is, or use Job Hunt on your PC (and, from your phone,
> Settings → App → *Use it from your phone*).

Job Hunt can run on a free cloud computer from Oracle, all day, with your PC off. You open it at your own web
address, like **https://jobs.yourname.com**, from any browser on your phone or any computer, and can add it to
your phone's home screen like an app.

It stays private through **Cloudflare**: before anyone sees Job Hunt, Cloudflare emails a one-time code to the
address you allowed (yours, and your friend's for their copy), and only then does Job Hunt ask for its own
password. Nothing on the Oracle computer is opened to the internet: Cloudflare's tunnel connects out from it.

It takes about an hour the first time. Costs: a domain name, about US$10 a year from Cloudflare. Oracle needs a
credit card to check you're a real person, but the setup below stays inside its **Always Free** limits, so
nothing is charged there. One free computer is enough for you and a friend (see step 10). (No domain? See
*Instead of Cloudflare: Tailscale* at the end.)

**Before you start, know that** your CVs, applications and Google sign-in will live on Oracle's computer
instead of yours. Cloudflare's email check and Job Hunt's password keep everyone else out, but it is someone else's machine.

## 1. Get ready on your PC

1. **Sync to Google Drive** (the easy way to bring everything over, and to switch between PC and server
   later). In the Windows app: Settings → Sync & backup → **Sync to Google Drive** → **Straight to Google Drive**,
   tick *Keep it up to date* and *Include saved keys and sign-ins*, **Save**. If Google was connected before
   Drive was added, reconnect it first (Settings → Accounts → Reconnect Google).
   (Or instead: Settings → Sync & backup → Backups → tick *Include saved keys and sign-ins* → **Back up now**, and keep
   the zip for step 8.)
2. **A Claude sign-in for the server**, to use your Claude subscription there. In PowerShell run
   `claude setup-token`, sign in when the browser opens, and copy the long token it prints. Keep it private.
   (Or skip it and add a Claude API key in Job Hunt's Settings → Accounts once the server runs.)

## 2. Create the Oracle account

1. Go to **oracle.com/cloud/free** → **Start for free**.
2. **Home region:** pick the one closest to you (for example **UK South (London)** or **UAE East (Dubai)**). You can't change this later, and free
   computers can only be created in your home region.
3. Finish the sign-up and card check. You land in the Oracle Cloud console.

## 3. Create the computer

1. Console menu → **Compute** → **Instances** → **Create instance**. Name it `job-hunt`.
2. **Image and shape** → **Edit**:
   - Image: **Canonical Ubuntu 24.04**.
   - Shape: **Change shape** → **Ampere** → **VM.Standard.A1.Flex**, with **2 OCPUs** and **12 GB** of
     memory. (Free covers up to 4 and 24 GB in total; this leaves room.)
3. **Networking:** keep the defaults (a new virtual cloud network, with a public IP address).
4. **Add SSH keys:** choose **Generate a key pair for me** and click **Save private key**. Keep that file;
   it's how you get into the computer.
5. **Create.** After a minute or two the state turns **Running**; copy its **Public IP address**.

If Oracle says **"Out of capacity"**: free ARM computers are in demand. Try again later, or choose another
**Availability domain** on the same page.

## 4. Connect to it

On Windows, open PowerShell in the folder with the private key and run (with your IP address):

```
ssh -i .\ssh-key-*.key ubuntu@<public IP>
```

Type `yes` the first time. You're now typing on the cloud computer. The next steps are all typed there; paste
each block and press Enter.

## 5. Install Docker

```
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
```

Type `exit`, then connect again with the same `ssh` command, so the change applies.

## 6. Start Job Hunt

```
mkdir -p ~/job-hunt/data ~/job-hunt/backups && cd ~/job-hunt
nano docker-compose.yml
```

Paste this in. Put your own password (8 or more characters) and the token from step 1.2 between the quotes:

```yaml
services:
  job-hunt:
    image: ghcr.io/hisxlnc/job-hunt-server:latest
    container_name: job-hunt
    restart: unless-stopped
    ports:
      - "127.0.0.1:8790:8790"
    environment:
      TZ: Europe/London   # your time zone
      JOBHUNT_PASSWORD: "choose-a-password"
      CLAUDE_CODE_OAUTH_TOKEN: ""
    volumes:
      - ./data:/data
      - ./backups:/backups
```

Save with **Ctrl+O**, **Enter**, then **Ctrl+X**. Start it:

```
docker compose up -d
```

`127.0.0.1:8790` means Job Hunt only listens to this computer itself: the Cloudflare tunnel (next step) is the
only way in.

## 7. Your web address, through Cloudflare

**7.1 A domain.** Go to **dash.cloudflare.com** and create a free account. Then **Domain Registration →
Register Domains**, search for a name (e.g. `yourname-jobs.com`; `.com` is about US$10.50 a year) and buy it.
Cloudflare sells at cost, and the domain is set up on Cloudflare at once. (A domain you already own elsewhere
works too: **Add a domain** and follow the steps to point it at Cloudflare.)

**7.2 Zero Trust.** In the dashboard's left menu choose **Zero Trust**. The first time, pick a team name (any
word) and the **Free** plan (up to 50 people; it may ask for a card but charges nothing).

**7.3 Who may open it (do this before the address goes live).** Zero Trust → **Access → Applications → Add an
application → Self-hosted**:
- Application name: `Job Hunt`. **Session duration:** 1 month (so your phone isn't asked every day).
- **Add public hostname:** subdomain `jobs`, domain `yourname-jobs.com`.
- **Policies → Add a policy:** name `Me`, action **Allow**, rule **Include → Emails →** your email address.
- Login methods: keep **One-time PIN**. Save.

**7.4 The tunnel.** Zero Trust → **Networks → Tunnels** (in newer dashboards **Networks → Connectors**) →
**Create a tunnel** → **Cloudflared** → name it `job-hunt` → **Save**. On the next page choose **Debian**
and **arm64**, and copy the command it shows (it starts with `curl` and ends with `sudo cloudflared service
install` and a long token). Paste it in your `ssh` window and press Enter. Back in the browser the tunnel shows
**Connected** within a minute; click **Next**.

**7.5 Point the address at Job Hunt.** On the **Public hostname** page: subdomain `jobs`, domain
`yourname-jobs.com`, **Service type HTTP**, **URL** `localhost:8790`. **Save tunnel**.
## 8. Open it and bring your data over

1. On your phone or laptop, open **https://jobs.yourname-jobs.com**. Cloudflare asks for your email and sends a
   code; type it in. Then sign in with your Job Hunt password.
2. On the Welcome page, under *Already using Job Hunt on another computer?*, press **Connect Google**:
   1. **Open Google sign-in** and approve with your Google account.
   2. Google then goes to a page that **doesn't open** (its address starts with `http://127.0.0.1`). That's
      expected: copy the whole address from the address bar.
   3. Paste it into Job Hunt and press **Finish**.
3. Job Hunt finds your data in Google Drive: press **Continue from …** on the Overview. It restarts with your
   CVs, applications, settings and sign-ins, and keeps syncing with Drive.
   (Using a backup zip instead: Settings → Sync & backup → Backups → **Restore from a backup…**.)
4. On the PC, **exit the Windows app** (tray icon → Exit) and untick *Start when I sign in*, or both will
   search and handle your email.

**On your phone, like an app:** open the address in Safari (iPhone: Share → **Add to Home Screen**) or Chrome
(Android: ⋮ → **Add to Home screen** / **Install app**). It opens full screen with Job Hunt's icon, tabs along
the bottom (Overview, Applications, Calendar, Inbox, and More for the rest).

## 9. Check the door is shut

Oracle's network only lets in SSH (port 22, which needs your private key file). Leave it that way:

1. Oracle console → **Networking** → **Virtual cloud networks** → your network → **Security Lists** →
   **Default Security List**: the only **Ingress rule** should be for port **22**.
2. Never add a rule for port 8790 (or 8791). Everything goes through the Cloudflare tunnel.

## 10. A friend on the same server (optional)

Your friend gets their own Job Hunt, with its own password, data, Claude, Gmail, Calendar and Drive. Nothing
is shared between the two. On the server (connect with the `ssh -i …` command from step 4):

```
mkdir -p ~/job-hunt/friend/data ~/job-hunt/friend/backups && cd ~/job-hunt
nano docker-compose.yml
```

Add a second service under `services:` (same indentation as `job-hunt:`), with **their** password and **their**
Claude token (they run `claude setup-token` on their own computer and send it to you privately, or leave it
empty and add their own Claude API key in Settings later):

```yaml
  job-hunt-friend:
    image: ghcr.io/hisxlnc/job-hunt-server:latest
    container_name: job-hunt-friend
    restart: unless-stopped
    ports:
      - "127.0.0.1:8791:8790"
    environment:
      TZ: Europe/London   # your time zone
      JOBHUNT_PASSWORD: "their-own-password"
      CLAUDE_CODE_OAUTH_TOKEN: ""
    volumes:
      - ./friend/data:/data
      - ./friend/backups:/backups
```

Save, then `docker compose up -d`. Then give them their own address in Cloudflare:

1. Zero Trust → **Access → Applications → Add an application → Self-hosted**: name `Job Hunt (friend)`, public
   hostname `jobs-friend` on your domain, a policy **Allow → Emails →** *their* email address. Save.
2. Zero Trust → **Networks → Tunnels** → `job-hunt` → **Edit** → **Public hostname → Add**: subdomain
   `jobs-friend`, your domain, **HTTP**, URL `localhost:8791`. Save.

They open **https://jobs-friend.yourname-jobs.com**, get a code at their email, and sign in with their password.
Their Welcome page takes them through Claude, their CV and **Connect Google** with *their* Google account. If
your Google project is still in *Testing* (see [SHARING.md](../SHARING.md)), add their Gmail address as a test
user first.

They could also run their own copy of this whole guide on their own Oracle account; nothing changes in Job Hunt.

## Switching between your PC and the server

With sync on (step 1.1), both keep their copy in your Google Drive. Use one at a time:

- **To use the PC:** open the Windows app. It sees the server is in use and offers **Take over**: the server
  saves its latest data and pauses, and the PC continues from it.
- **To go back to the server:** exit the Windows app (tray icon → Exit), open the server page and press **Use
  it here again**, then **Continue from …** on the Overview.

## Keeping it running

- **Updates.** When Settings → App says a new version is out, connect (the `ssh -i …` command from step 4) and run
  `cd ~/job-hunt && docker compose pull && docker compose up -d`. This updates your friend's copy too. Your
  data stays in `~/job-hunt/data` (and `~/job-hunt/friend/data`).
- **Backups.** Job Hunt backs up daily to `~/job-hunt/backups` and keeps 14. With Drive sync on, your latest
  copy is in Google Drive too.
- **Oracle can reclaim idle free computers.** If a free computer is barely used for 7 days, Oracle may stop it.
  Job Hunt is light, so this can happen. To prevent it, upgrade the account to **Pay As You Go** (Billing →
  Upgrade). It stays free as long as you only use Always Free resources. Then set a **Budget** with an alert at
  $1, so you'd hear about any charge at once. With Drive sync on, a new server picks up where you left off.
- **Google sign-in** can be renewed right on the server: Settings → Accounts → **Reconnect Google**, and
  paste the address back as in step 8.

## Instead of Cloudflare: Tailscale (free, no domain)

Tailscale makes a private network of your own devices: the server is reachable only from devices signed in to
your Tailscale account, with an app installed on each (phone and laptop).

1. On the server: `curl -fsSL https://tailscale.com/install.sh | sh` then `sudo tailscale up --ssh --hostname job-hunt`,
   and open the link it prints to sign in (a free account, e.g. with Google).
2. In `docker-compose.yml`, change the ports line to `"8790:8790"` and run `docker compose up -d`.
3. Install Tailscale on your phone and laptop with the same account, and open **http://job-hunt:8790**.
4. Skip step 7. For a friend, share the machine with them in the Tailscale admin console (Machines → `job-hunt` →
   Share), and they open `http://job-hunt:8791`.
