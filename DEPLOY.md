# Deploying to Vercel

About 15 minutes end to end. You need two things you already have: an
Anthropic API key (`sk-ant-...`) and a Neon Postgres connection string.

---

## 1. Set up the database (5 min)

Neon's free tier is enough.

1. Go to https://neon.tech and create a project
2. Copy the connection string — it looks like
   `postgresql://user:pass@ep-xxx.us-west-2.aws.neon.tech/neondb?sslmode=require`
3. Keep that tab open, you'll paste it twice

---

## 2. Create the tables and load your schedule (5 min)

This runs from your own machine, once. You need [Node](https://nodejs.org)
and [Git](https://git-scm.com/downloads) installed.

### Windows (PowerShell)

Run these **one line at a time**. Do not run them from `C:\WINDOWS\system32` —
Windows blocks writing there and the clone will fail with "Permission denied".
Older PowerShell also does not accept `&&`, so keep the lines separate.

```powershell
cd ~\Documents
git clone https://github.com/hashimthespeed-tech/Personal-Schedueler.git
cd Personal-Schedueler
npm install
Copy-Item .env.example .env
npx web-push generate-vapid-keys
notepad .env
```

If `npx` asks `Ok to proceed? (y)`, type `y` and press Enter.

To generate the two random secrets, run this twice — the first result is
`SESSION_PASSWORD`, the second is `CRON_SECRET`:

```powershell
-join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
```

### macOS / Linux

```bash
cd ~
git clone https://github.com/hashimthespeed-tech/Personal-Schedueler.git
cd Personal-Schedueler
npm install
cp .env.example .env
npx web-push generate-vapid-keys
openssl rand -hex 24    # run twice: SESSION_PASSWORD, then CRON_SECRET
```

### Fill in .env, then create the tables

Nine values, listed in the table in step 3 below. Then:

```
npm run db:push    # creates the tables
npm run db:seed    # loads your courses, bell schedules, settings, goals
```

`db:seed` should print 7 courses and 75 fixed commitments. If it does, the
database is ready.

> No terminal, or stuck? Deploy first — the site will error on a missing
> table. Run `db:push` and `db:seed` later from anywhere with Node, pointed
> at the same DATABASE_URL, then reload.

## 3. Deploy (5 min)

1. Go to https://vercel.com and sign in with GitHub
2. **Add New → Project**, pick `Personal-Schedueler`
3. Vercel detects Next.js automatically — do not change the build settings
4. Expand **Environment Variables** and add all nine before you deploy:

| Name | Value |
|---|---|
| `DATABASE_URL` | your Neon string, starts `postgresql://` |
| `ANTHROPIC_API_KEY` | your key, starts `sk-ant-` |
| `SESSION_PASSWORD` | first random string from step 2 |
| `APP_PASSPHRASE` | you pick this — it is your login to the app |
| `VAPID_PUBLIC_KEY` | Public Key printed by `web-push` |
| `VAPID_PRIVATE_KEY` | Private Key printed by `web-push` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | the Public Key again — same value |
| `VAPID_SUBJECT` | `mailto:` then your email |
| `CRON_SECRET` | second random string from step 2 |

The same nine go in your local `.env`. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` really is
a duplicate of `VAPID_PUBLIC_KEY`: the `NEXT_PUBLIC_` copy is the one the
browser is allowed to read, which is why the private key has no twin.

5. **Deploy**

If you skipped step 2, your first load will error on a missing table. Run
`db:push` and `db:seed` against the same DATABASE_URL, then reload.

---

## 4. Put it on your phone (2 min)

This step is not optional if you want reminders. On iOS, web push only
works from an installed app — never from a Safari tab.

1. Open your Vercel URL **in Safari** on your phone
2. Log in with your `APP_PASSPHRASE`
3. Tap **Share** → **Add to Home Screen**
4. Open it from the home screen icon, not Safari
5. Go to **Settings** in the app → **Enable** reminders

---

## What runs on its own

The nightly review fires at `0 10 * * *` UTC — 3am PDT, 2am PST. That is
after your check-in and before your 6am wake, in both halves of the year.
It re-solves the week, makes any trade-offs needed, and pushes a
notification when tomorrow's plan is ready.

Vercel's free tier allows one cron per day, which is exactly what this uses.

---

## Cost

| | |
|---|---|
| Vercel Hobby | free |
| Neon free tier | free |
| Anthropic API | a few dollars a month at a handful of agent turns a day |

The nightly review is one Opus 5 call. Chatting with an agent is one call per
message. Nothing else costs anything — the scheduler itself is plain
arithmetic and runs free.

---

## Function time limits

Agent turns run Opus 5 with adaptive thinking, which usually takes 20-60
seconds. Both `/api/agent/[agent]` and `/api/replan` declare
`maxDuration = 60`, the Hobby ceiling. On Pro you can raise it to 300.

This is also why the app is on Vercel rather than Netlify: Netlify caps
synchronous functions at 10s on free and 26s on Pro, which is under what an
agent turn needs. Moving there would require reworking agent calls into
background jobs with the UI polling for results.

---

## Updating it later

Push to `main` and Vercel redeploys automatically. If you change
`src/db/schema.ts`, run `npm run db:push` again against the same database.
