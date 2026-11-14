# CardKeep

Scan visiting/business cards with your phone camera (or upload a photo). The details are read automatically, you review them, then save the contact to:

- **Your phone**: a `.vcf` contact file (iPhone and Android open "Add Contact")
- **Google Contacts**: through the Google People API, with a "CardKeep" label and a duplicate check
- **CardKeep's own list**: search, filter by event, export everything as `.vcf` or CSV (Excel)

Built with Next.js 15, Tailwind CSS and the Claude API (vision) for reading cards.

## How it works

1. **Take Photo / Choose Photo / Live Camera**: the image is resized in the browser (max 1600px JPEG).
2. `POST /api/extract` (server) sends the image to Claude, which returns structured JSON. Anything not printed on the card stays blank.
3. You review and edit the fields, add the event where you met, then save.

Contacts saved in the app are stored in your browser (localStorage) on that device.

## Setup

### 1. Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com → API Keys (server-only, never exposed to the browser) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google Cloud Console (see below) |

### 2. Google Contacts (OAuth Client ID)

1. Go to https://console.cloud.google.com and create a project (e.g. "CardKeep").
2. **APIs & Services → Library**: enable **People API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform): choose *External*, fill in the app name and your email.
   Under **Data access**, add the scope `https://www.googleapis.com/auth/contacts`.
   Under **Audience**, add your own Gmail address as a **Test user**.
4. **Credentials → Create credentials → OAuth client ID** → type **Web application**.
   Under **Authorized JavaScript origins** add:
   - `http://localhost:3000`
   - your Vercel URL, e.g. `https://cardkeep.vercel.app`
5. Copy the Client ID into `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

While the app is in "Testing" mode, Google shows an "unverified app" warning on sign-in. Click *Continue*. That's fine for personal use.

### 3. Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. The camera needs HTTPS on phones, so test on the deployed Vercel URL.

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project**, then import the repo (framework: Next.js, auto-detected).
3. Add both environment variables in **Settings → Environment Variables**, then deploy.
4. Add the Vercel URL to the Google OAuth client's **Authorized JavaScript origins**.

## Install on your phone

Open the Vercel URL on your phone, then:
- **iPhone (Safari)**: Share → *Add to Home Screen*
- **Android (Chrome)**: menu ⋮ → *Install app* / *Add to Home screen*

Tip: on Android, saving to Google Contacts also puts the contact on your phone automatically through Google sync.
