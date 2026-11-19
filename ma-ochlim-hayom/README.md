# מה אוכלים היום? — "What are we eating today?"

A Tinder-style restaurant picker for Israel. Hebrew, RTL, mobile-first. Swipe solo or with a friend; when you both like the same place you get a match.

**Stack:** Vite + React 19 + TypeScript + Tailwind v4 + Motion (swipe physics), Supabase (Postgres, Realtime, Storage, Edge Functions). It's built to drop straight into **Bolt.new**: Bolt's database integration is Supabase, and its hosting publishes the site.

```
src/                      the app (pages, components, state, lib)
supabase/migrations/      database schema, security rules, realtime, storage buckets
supabase/functions/       photo (photo cache), seed (Google Places import), stats (/stats data)
supabase/functions/_shared/seedCore.js   seed logic shared by the edge function and the CLI script
scripts/seed.mjs          CLI seed: GOOGLE_PLACES_API_KEY=... npm run seed
public/                   og-image, icons, manifest, service worker, sample (demo) data
```

The app works right away in **demo mode**, with no database and no key: fictional restaurants, emoji illustrations instead of photos, and friend mode working across two tabs of the same browser. It switches to real data on its own once the database is connected and the seed has run.

---

## 1. Put it on Bolt (about 15 minutes)

1. **Import the code.** Unzip, push the folder to a new GitHub repo, then open `https://bolt.new/~/github.com/<you>/<repo>`. You can also use Bolt's *Import → GitHub* button, or drag the folder into a new Bolt project.
2. **Connect the database.** In Bolt, open the database/integrations panel and choose **Supabase → Connect**. Create a new project if Bolt asks. Bolt then fills in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. **Apply the schema and functions.** Paste this into the Bolt chat:
   > This project already contains a Supabase migration in `supabase/migrations` and three edge functions in `supabase/functions` (`photo`, `seed`, `stats`, sharing `_shared/`). Apply the migration and deploy the three functions exactly as they are, with JWT verification **disabled** for all three (see `supabase/config.toml`). Do not change any app code.
4. **Add the server secrets.** In the Supabase dashboard (Project → Edge Functions → **Secrets**), or Bolt's secrets panel if it offers one, add:
   - `GOOGLE_PLACES_API_KEY` = your key (see section 2)
   - `ADMIN_PASSWORD` = any password you choose. It protects `/stats` and the seed button.
5. **Publish.** Click **Publish / Deploy** in Bolt and copy the URL (for example `https://xxxx.bolt.host`).
6. **Set `VITE_SITE_URL`** to that URL in the project's environment variables, then publish again. LinkedIn and WhatsApp previews need the absolute `og:image` URL.
7. **Load the restaurants.** Open `https://<your-url>/stats`, enter `ADMIN_PASSWORD`, and click **"רענון נתונים מ-Google Places"**. It makes about 90 API calls and takes under a minute. Reload the app: real restaurants and photos.
8. *(Optional)* Add `VITE_GA4_ID` (G-XXXX) and `VITE_META_PIXEL_ID`, then publish again.

> Never put the Google key in a `VITE_` variable. Those are bundled into the browser. It belongs only in the edge function secrets.

---

## 2. Google Places API key: click by click

1. Go to **console.cloud.google.com**. Click the project picker (top bar) → **New project** → name it `ma-ochlim` → **Create**, then select it.
2. **Billing:** ☰ menu → **Billing** → *Link a billing account* → create one and add a card. Google requires this even for free-tier usage.
3. **Enable the API:** ☰ → **APIs & Services → Library** → search **"Places API (New)"** → open it → **Enable**. Make sure it's the one marked *(New)*.
4. **Create the key:** **APIs & Services → Credentials → + Create credentials → API key**, then copy it.
5. **Restrict it:** click the key's name → *API restrictions* → **Restrict key** → tick only **Places API (New)** → **Save**. Leave *Application restrictions* on **None**: the key is only used from the server, and Supabase functions have no fixed IP.
6. **Set a low daily quota (hard cap):** **APIs & Services → Enabled APIs & services → Places API (New) → Quotas & System Limits**. Filter for "per day", then edit:
   - **SearchNearby requests per day** → `200` (one seed uses about 90)
   - **GetPhotoMedia / Place photo requests per day** → `1000`
7. **Budget alert:** ☰ → **Billing → Budgets & alerts → Create budget**, set $5, with alerts at 50/90/100%. A budget only alerts; the quotas in step 6 are the actual cap.
8. Paste the key **only** into the Supabase secret `GOOGLE_PLACES_API_KEY` (section 1, step 4).

---

## 3. How the data works (zero Google calls per visitor)

- **Seed** (`supabase/functions/_shared/seedCore.js`): Nearby Search (`POST places:searchNearby`, max 20 results per call) across a grid. Tel Aviv-Yafo gets 8 center points × 10 type groups (restaurant, pizza, sushi/japanese, burger, italian, asian, middle-eastern/mediterranean, steak/bbq, vegan/vegetarian, cafe/brunch). Ramat Gan, Herzliya, Rishon, Jerusalem and Haifa get a light pass. **90 calls total.** Results are deduped by place id.
- **Strict field mask:** `id, displayName, formattedAddress, location, rating, userRatingCount, priceLevel, primaryType, types, photos`. No reviews and no Atmosphere fields.
- **Cleaning:** places are dropped if they have no photo, no rating, a rating below 3.8, or fewer than 30 ratings. A missing `priceLevel` means "unknown": the place is included in every price filter and shows no price tag. A Hebrew cuisine is derived from the Google types (איטלקי, פיצה, סושי, המבורגר, אסייתי, מזרח תיכוני, בשרים, צמחוני, בית קפה, אחר).
- **Output:** `data/restaurants.json` in Supabase Storage. This is the public file the browser loads, and it has no photo resource names. `data/restaurants.full.json` is the server copy the photo function uses.
- **Photos:** `/functions/v1/photo?id=<placeId>`. The first request fetches one 800px photo from the Places Photos endpoint and stores it in the `photos` bucket. Every later request is a redirect to the cached file with `Cache-Control: max-age=1 year`. So each photo hits Google **at most once per data refresh**, and only ids from the seeded data are accepted. If a photo fails, the card shows a cuisine-based illustration.
- **Filtering** (distance via haversine, price, cuisine) runs in the browser against the JSON.
- **Attribution:** every card and result shows the photo author (from Google's `authorAttributions`) and "Google Maps".

### Refresh monthly
Google's terms limit long-term caching of Places content (place ids may be stored). **Re-run the seed about once a month** with the button on `/stats`. It also clears the photo cache so photos are refreshed with the data.

CLI alternative: `GOOGLE_PLACES_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed`. This writes `public/data/restaurants.json` and uploads both files to Storage.

### Expected cost
Per seed: about 90 Nearby Search calls (Enterprise SKU, because rating, rating count and price are requested). Photos: at most one call per restaurant per month (about 150–300). Google gives a monthly free usage allowance per SKU, so in practice this is **$0 to a few dollars a month**. Check the current Maps pricing page. The daily quotas in section 2 make overspending impossible.

---

## 4. Environment variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Bolt env (set by the Supabase connect) | for real data + friend mode across devices | public client config |
| `VITE_SITE_URL` | Bolt env | recommended | absolute URLs for Open Graph previews |
| `VITE_GA4_ID` | Bolt env | optional | Google Analytics 4 |
| `VITE_META_PIXEL_ID` | Bolt env | optional | Meta Pixel |
| `GOOGLE_PLACES_API_KEY` | Supabase Edge Function secret | for seed + photos | **server-side only** |
| `ADMIN_PASSWORD` | Supabase Edge Function secret | for /stats + seed | admin password |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into edge functions automatically.

---

## 5. Analytics and `/stats`

- **Events** fire at every stage: `app_open, cta_click, mode_selected (solo/friend), location_set, price_selected, cuisine_selected, first_swipe, swipe_like, swipe_skip, session_created, friend_joined, match_found, navigate_clicked, share_clicked` (plus `solo_result`).
- **Meta standard events:** `Lead` on session_created, `CompleteRegistration` on match_found and solo_result, `FindLocation` on location_set, `Contact` on navigate_clicked.
- **UTMs:** `utm_source/medium/campaign/content` are captured on first load, kept for the browser session, and attached to every GA4/Pixel event.
- **Consent:** GA4 and the Pixel load **only after cookie consent** (banner, plus a toggle on `/privacy`). Events from before consent are replayed once the user accepts.
- **`/stats`** (hidden, `noindex`, password = `ADMIN_PASSWORD`): funnel visits → CTA → location → first swipe → match / solo pick, all event totals, a daily table, the data refresh date and the seed button. Counts are anonymous aggregates in the `event_counts` table, which can only be written through an allow-listed `track_event` function. A match is counted once per pair, not once per person.

---

## 6. Friend mode details

- The creator's settings plus a **frozen deck** (the list of place ids, deterministically shuffled with seed `code:round`) are stored in `sessions`. Both people see the same cards in the same order.
- 4-character codes (no ambiguous characters). The share link is `/s/CODE`, with a WhatsApp button and a ready-made Hebrew message. No registration: each person is a random UUID kept in their browser.
- **Realtime:** Supabase Realtime on sessions, members and likes, with a 10s polling fallback and re-sync on reconnect, tab focus, or right after your own like. You see live friend progress ("החבר שלך בכרטיס 7 מתוך 40"), online/offline status, a match overlay with confetti, and "המשיכו לחפש".
- **Refresh-safe:** progress and likes are restored from the server, and matches you've already seen aren't shown again.
- If you both finish with no match: **"הרחיבו רדיוס"** (+1.5 km; at 5 km it drops the price and cuisine filters) or **"מתחילים מחדש"**. Both start a new round for both people.
- Sessions expire after **24h**: row security hides expired rooms, and they're deleted a day later.
- **Security:** row-level security on every table. Clients can never change `expires_at`, and a room holds at most 6 members.

---

## 7. What was tested (automated, headless Chromium, iPhone 13 / Pixel 7 profiles)

53 checks passed with **no console errors**:

- **Solo flow:** landing → mode → location/price (live count) → cuisine chips (only cuisines that exist, with counts) → swipe by drag, buttons and arrow keys; undo; small drag snaps back; refresh mid-swipe keeps your place; "סיימתי" → head-to-head → final card with Google Maps and Waze links and share.
- **Solo, no likes:** the empty state offers "widen search" or "restart".
- **Location denied:** Hebrew alert, falls back to the area list. GPS success path works too.
- **Empty results:** Hebrew suggestion message, continue button disabled.
- **Friend mode, two simultaneous sessions** (local mode, and against a mock of the Supabase REST API in separate browser contexts): code + WhatsApp message; creator sees the friend join; same card order; live progress; match shown to both; continue after a match; refresh restores progress; seen matches not repeated; undo, including after a refresh; both finish → matches list; widen radius / restart sync to the friend; no-match screen; unknown or expired code; aggregate counters count a match and a join once.
- **Offline/reconnect** during a friend session: an indicator appears and clears.
- **Slow network** (≈1.6 Mbps, 150ms latency, cold cache): first card in **≈1.9s**.
- **Reduced motion:** swipe buttons work, with no fly-out or rotation animations.
- `/privacy`, `/stats`, and a desktop layout.

**Not testable here:** a real Supabase project (Realtime websockets, Storage, edge functions run against Supabase), real Google Places calls, and physical iPhone Safari / Android Chrome. Check these after deploying: run the seed, open the app on two phones, and make a match.

---

## Credits
Restaurant data and photos © Google Maps / their authors. The OG image uses Twemoji graphics (CC-BY 4.0).
