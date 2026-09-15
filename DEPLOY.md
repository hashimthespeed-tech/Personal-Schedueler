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

## 2. Create the tables and load your schedule (3 min)

This runs from your own machine, once. You need Node installed.

```bash
git clone https://github.com/hashimthespeed-tech/Personal-Schedueler.git
cd Personal-Schedueler
npm install

cp .env.example .env
# open .env and fill in DATABASE_URL and ANTHROPIC_API_KEY

npx web-push generate-vapid-keys
# paste the two keys into .env as VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY,
# and the public one AGAIN as NEXT_PUBLIC_VAPID_PUBLIC_KEY

npm run db:push    # creates the tables
npm run db:seed    # loads your courses, bell schedules, settings, goals
```

`db:seed` should print your 7 courses and 75 fixed commitments. If it does,
the database is ready.

> No terminal? Skip this for now — deploy first, then run `db:push` and
> `db:seed` from anywhere that has Node, pointed at the same DATABASE_URL.

---

## 3. Deploy (5 min)

1. Go to https://vercel.com and sign in with GitHub
2. **Add New → Project**, pick `Personal-Schedueler`
3. Vercel detects Next.js automatically — do not change the build settings
4. Expand **Environment Variables** and add these before you deploy:

| Name | Value |
|---|---|
| `DATABASE_URL` | your Neon string |
| `ANTHROPIC_API_KEY` | your `sk-ant-...` key |
| `SESSION_PASSWORD` | any random string, 32+ characters |
| `APP_PASSPHRASE` | whatever you want your login to be |
| `VAPID_PUBLIC_KEY` | from step 2 |
| `VAPID_PRIVATE_KEY` | from step 2 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | same as VAPID_PUBLIC_KEY |
| `VAPID_SUBJECT` | `mailto:your@email.com` |
| `CRON_SECRET` | any random string |

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
