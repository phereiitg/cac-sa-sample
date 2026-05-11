# Summer Analytics 2025 — Course Platform

Full-stack course portal for **Summer Analytics 2025** by the **Consulting & Analytics Club, IIT Guwahati**.  
Built with pure HTML/CSS/JS + **Supabase** as the backend. No build tools, no Node.js required.

---

## ✦ Feature Overview

| Feature | Details |
|---|---|
| **Auth** | Google OAuth via Supabase Auth |
| **Course Dashboard** | Week-by-week accordion (Day / Description / Task 1-3), published by admin |
| **Announcements** | Admin-managed banners with links |
| **Weekly Quiz** | Fullscreen iframe quiz (TestPortal or any URL) |
| **Quiz Security** | Fullscreen lock · Tab-switch detection · Window-blur detection · Violation logging |
| **Quiz Results** | Per-participant score + percentage + answer breakdown (Q-by-Q if available) |
| **Leaderboard** | Live top-100 leaderboard by cumulative score |
| **Admin Panel** | Week content editor · Quiz config · Participant list · Results viewer · Violations log · Announcements |
| **Webhook** | TestPortal webhook endpoint saves scores automatically |
| **CSV Export** | Export participants & results from admin panel |
| **Print / PDF** | Results page is print-ready |

---

## ✦ File Structure

```
sa2025/
├── index.html              ← Login / landing page
├── auth-callback.html      ← Google OAuth redirect handler
├── complete-profile.html   ← One-time profile form
├── dashboard.html          ← Main student dashboard
├── results.html            ← Detailed individual results page
├── admin.html              ← Admin management panel
│
├── js/
│   ├── supabase-client.js  ← Supabase init (put your keys here)
│   ├── auth.js             ← Shared auth helpers & toast
│   ├── dashboard.js        ← Student dashboard logic
│   └── admin.js            ← Admin panel logic
│
└── supabase/
    ├── schema.sql          ← Run once in Supabase SQL Editor
    └── functions/
        ├── get-test-link/index.ts   ← Edge function: secure quiz URL
        └── quiz-webhook/index.ts    ← Edge function: receive scores
```

---

## ✦ Setup Guide (Step by Step)

### Step 1 — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Note your **Project URL** and **anon public key** (Dashboard → Settings → API)

### Step 2 — Run the Database Schema

1. Go to **SQL Editor** in your Supabase dashboard
2. Open `supabase/schema.sql`
3. Paste the entire file and click **Run**

This creates all tables, RLS policies, and indexes.

### Step 3 — Configure your keys

Open `js/supabase-client.js` and replace the two placeholders:

```js
const SUPABASE_URL  = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON = "YOUR_ANON_PUBLIC_KEY";
```

Also open `js/dashboard.js` and update:
```js
const API_BASE = "https://YOUR_PROJECT.supabase.co/functions/v1";
```

### Step 4 — Enable Google OAuth

1. Supabase Dashboard → **Authentication → Providers → Google**
2. Enable it; add your Google OAuth client ID & secret
   (Create at [console.cloud.google.com](https://console.cloud.google.com) → APIs & Credentials → OAuth 2.0 Client IDs)
3. Authorised redirect URIs: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
4. In Supabase Auth → URL Configuration, set:
   - Site URL: `https://YOUR_DOMAIN`
   - Redirect URLs: `https://YOUR_DOMAIN/auth-callback.html`

### Step 5 — Deploy Edge Functions (optional but recommended)

Install Supabase CLI:
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Deploy both functions:
```bash
supabase functions deploy get-test-link
supabase functions deploy quiz-webhook
```

Set required secrets:
```bash
supabase secrets set QUIZ_WEBHOOK_SECRET=your_random_secret_here
```

> **Note:** If you skip edge functions, the quiz will still work — it loads the `quiz_url` directly from the database. The webhook is only needed if you want TestPortal to auto-post scores.

### Step 6 — Set the first Admin

After you log in with Google for the first time, run this in Supabase SQL Editor:

```sql
UPDATE profiles SET is_admin = true WHERE email = 'your@email.com';
```

Then visit `/admin.html` to access the admin panel.

### Step 7 — Host on GitHub Pages (or any static host)

Push the `sa2025/` folder to a GitHub repo, then:
- Repo → Settings → Pages → Source: main branch / root
- Your site will be at `https://USERNAME.github.io/REPO/`

Or use **Netlify** (drag & drop the folder at [netlify.com](https://netlify.com)).

---

## ✦ Weekly Workflow

### Every Monday — Launch a New Week

1. Go to `/admin.html` → **Course Content**
2. Select the week (e.g. Week 3)
3. Edit the title, then click **+ Add Day** for each day (Day 1 … Day 5)
4. For each day: fill in the description and Task 1/2/3 labels + URLs
5. **Toggle "Published"** → the week becomes visible to students immediately

### Every Monday — Set the Quiz

1. Go to **Quiz Manager**
2. Fill in:
   - Week Number (e.g. 3)
   - Quiz Title (e.g. "Week 3 Quiz")
   - Quiz URL (your TestPortal test link)
   - Opens At / Closes At (optional time window)
   - Max Score and Time Limit
3. Check **"Quiz is Active"**
4. Click **Save Quiz Config**

Students will see the quiz become live on their dashboard immediately.

### Announcements

1. Go to **Announcements** in admin
2. Fill in title, body, and any links (format: `Label|URL` one per line)
3. Post — students see it as a dismissable banner on their dashboard

---

## ✦ Quiz Security Features

The quiz runs in a **full-screen overlay** inside the student's browser:

| Feature | Behaviour |
|---|---|
| **Fullscreen lock** | Quiz overlay requests fullscreen on start |
| **Fullscreen exit detection** | Logs a violation; shows warning popup; re-requests fullscreen |
| **Tab switch detection** | `visibilitychange` event — logged + popup |
| **Window blur detection** | `window blur` event — logged + popup |
| **Violation counter** | Shown live in quiz top bar (green → yellow → red) |
| **Auto-close** | After 5 violations, quiz closes automatically |
| **Violation log** | All violations stored in `quiz_violations` table with timestamp |
| **Score annotation** | Final score record includes `tab_switches` and `fullscreen_exits` count |

Admins can view the full violation log in **Admin → Violations**.

---

## ✦ Quiz Scores & Results

**How scores get saved:**

1. **Via TestPortal Webhook (recommended):** TestPortal calls your `/quiz-webhook` edge function automatically when a student submits. The function matches the email to a profile, saves the score, and annotates it with the violation count.

2. **Manual import:** Admin can use the CSV export + re-import if needed.

**What students see on the Results page:**
- Score and percentage with a progress bar
- Grade label (Excellent / Good / Average / Needs Improvement)
- Time taken
- Violation summary (tab switches, fullscreen exits)
- Feedback message (from TestPortal)
- Full Q-by-Q answer breakdown (if TestPortal sends `answers` in the webhook payload)

**Configuring TestPortal Webhook:**
1. TestPortal admin → your test → Settings → Webhook
2. URL: `https://YOUR_PROJECT.supabase.co/functions/v1/quiz-webhook`
3. Add header: `x-webhook-secret: your_random_secret_here`

---

## ✦ Updating Partner Logos

In `dashboard.html`, find the `#partnerLogos` div and update the partner names/styles. To add actual image logos, replace the text items with `<img>` tags pointing to logo files in your repo.

---

## ✦ Discord Link

In `dashboard.html`, update the `.discord-btn` href:
```html
<a class="discord-btn" href="https://discord.gg/YOUR_INVITE_CODE" ...>
```

---

## ✦ Database Tables Reference

| Table | Purpose |
|---|---|
| `profiles` | Student info (name, college, year, branch, etc.) |
| `announcements` | Banner announcements (admin-managed) |
| `weeks` | Week metadata (title, published status) |
| `week_days` | Daily content rows (description + 3 tasks per day) |
| `quiz_config` | Quiz configuration per week (URL, time window, score) |
| `quiz_scores` | Quiz results per student per week (score, answers, violations) |
| `quiz_violations` | Detailed violation log (tab switch, fullscreen exit, etc.) |

---

## ✦ Troubleshooting

**Login loop:** Check that your redirect URL in Supabase Auth settings matches exactly (including trailing slash).

**"No weeks published":** Go to Admin → Content, select a week, fill in days, and toggle Published.

**Scores not appearing:** Check that the webhook URL is correct and the `x-webhook-secret` header matches what you set via `supabase secrets set`.

**Admin panel redirects to dashboard:** Make sure you've run `UPDATE profiles SET is_admin = true WHERE email = 'you@email.com';`

---

*Summer Analytics 2025 · Consulting & Analytics Club, IIT Guwahati*
