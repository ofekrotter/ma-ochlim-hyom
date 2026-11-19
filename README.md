# מה אוכלים היום? — "What are we eating today?"

A swipe-style restaurant picker for Israel. Hebrew, RTL, mobile-first. Swipe solo or with friends; when the group agrees on a place you get a match. Not affiliated with Google, Wolt, or Waze.

**Stack:** Vite + React 19 + TypeScript + Tailwind v4 + Motion (swipe physics), Supabase (Postgres, Realtime, Storage, Edge Functions). It's built to drop straight into **Bolt.new**: Bolt's database integration is Supabase, and its hosting publishes **the repository root**. Keep `package.json`, `src/`, and `supabase/` here — a nested copy of the app will not be what Bolt builds.

```
src/                      the app (pages, components, state, lib)
supabase/migrations/      database schema, security rules, realtime, storage buckets
supabase/functions/       photo (photo cache), seed (Google Places import), stats (/stats data)
supabase/functions/_shared/seedCore.js   seed logic shared by the edge function and the CLI script
scripts/seed.mjs          CLI seed: GOOGLE_PLACES_API_KEY=... npm run seed
public/                   og-image, icons, manifest, service worker, sample (demo) data
tests/                    open-now, photo-cap, and seed field-mask tests (`npm test`)
```

The app works right away in **demo mode**, with no database and no key: fictional restaurants, emoji illustrations instead of photos, and friend mode working across two tabs of the same browser. It switches to real data on its own once the database is connected and the seed has run.

---

## 1. Put it on Bolt (about 15 minutes)

1. **Import the code.** Unzip, push the folder to a new GitHub repo, then open `https://bolt.new/~/github.com/<you>/<repo>`. You can also use Bolt's *Import → GitHub* button, or drag the folder into a new Bolt project.
2. **Connect the database.** In Bolt, open the database/integrations panel and choose **Supabase → Connect**. Create a new project if Bolt asks. Bolt then fills in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. **Apply the schema and functions.** Paste this into the Bolt chat:
   > This project already contains Supabase migrations in `supabase/migrations` and three edge functions in `supabase/functions` (`photo`, `seed`, `stats`, sharing `_shared/`). Apply every migration, including `20261119140000_lock_down_public_access.sql`, and deploy the three functions exactly as they are, with JWT verification **disabled** for all three (see `supabase/config.toml`). Apply the migration before deploying the functions. Do not change any app code.
4. **Add the server secrets.** In the Supabase dashboard (Project → Edge Functions → **Secrets**), or Bolt's secrets panel if it offers one, add:
   - `GOOGLE_PLACES_API_KEY` = your key (see section 2)
   - `ADMIN_PASSWORD` = any password you choose. It protects `/stats` and the seed button.
5. **Publish.** Click **Publish / Deploy** in Bolt and copy the URL (for example `https://xxxx.bolt.host`).
6. **Set `VITE_SITE_URL`** to that URL in the project's environment variables, then publish again. LinkedIn and WhatsApp previews need the absolute `og:image` URL.
7. **Load the restaurants.** Open `https://<your-url>/stats`, enter `ADMIN_PASSWORD`, and click **"רענון נתונים מ-Google Places"**. It makes **90 Nearby Search calls** (opening hours and up to 5 photo references are part of those same calls — no extra Places requests, and no photo downloads during the seed) and takes under a minute. Publish the updated `photo` and `seed` functions **before** this refresh, or extra pictures will still resolve to the first photo. Reload the app: real restaurants, hours, and photos.
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
- **Strict field mask:** `id, displayName, formattedAddress, location, rating, userRatingCount, priceLevel, primaryType, types, photos, regularOpeningHours`. No reviews and no Atmosphere fields. `regularOpeningHours` is an **Enterprise** field — the same SKU already triggered by rating, rating count, and price — so adding it does **not** add calls or move the request to Enterprise + Atmosphere. `currentOpeningHours` is intentionally not requested: it is only the current week and would go stale before the next monthly refresh. Shabbat shows up as whatever weekly periods Places returns (often no Saturday period, Friday closing early). The app does not invent a Shabbat calendar.
- **Cleaning:** places are dropped if they have no photo, no rating, a rating below 3.8, or fewer than 30 ratings. A missing `priceLevel` means "unknown": the place is included in every price filter and shows no price tag. A Hebrew cuisine is derived from the Google types (איטלקי, פיצה, סושי, המבורגר, אסייתי, מזרח תיכוני, בשרים, צמחוני, בית קפה, אחר).
- **Opening hours:** each place stores compact weekly periods (`[openDay, openHour, openMinute, closeDay, closeHour, closeMinute]`, Sunday = 0). `hours: null` means Places had no `regularOpeningHours` — **the restaurant stays in the deck**. Periods may cross midnight or the Sunday boundary. The browser evaluates them in `Asia/Jerusalem` (DST included). Search counts (area and cuisine) and new decks include only places open at that moment. A solo or friend deck is frozen when the round starts, so cards don't jump if the clock ticks mid-swipe. The final solo pick is checked again, so a place that closed before you finish isn't the recommendation.
- **Output:** `data/restaurants.json` in Supabase Storage. This is the public file the browser loads. It has `hours`, `photoCount`, and author names — **no photo resource names**. `data/restaurants.full.json` is the server copy (`photo` plus up to 5 `photos[]` names) the photo function uses. Old app builds ignore the new fields. New app builds still work on a file that has neither `hours` nor `photoCount` (unknown hours are kept, one photo if `hasPhoto`).
- **Photos:** `/functions/v1/photo?id=<placeId>` is photo 0 and still caches as `<id>.jpg`. Extra frames are `/functions/v1/photo?id=<placeId>&i=1` (up to `i=4`), cached as `<id>-<i>.jpg`. The card loads photo 0 immediately and the next frame only after the viewer taps forward — not all five up front. Each frame hits Google **at most once per 30 days**, and only indexes present in the seeded file are accepted. The function also refuses a Google call once 400 new photos have been fetched that UTC day, and it will not fetch at all if the seeded file is older than 30 days. If a photo fails, the card shows a cuisine-based illustration. On the swipe card, tap the left half of the photo for the previous picture and the right half for the next; a horizontal swipe still likes or skips. Progress bars sit on top of the card when there is more than one photo. The photo manifest (`restaurants.full.json`) is stored in the private `data-private` bucket; the public file has no photo resource names.
- **Filtering** (distance via haversine, price, minimum rating, cuisine, open-now) runs in the browser against the JSON. A missing price stays in every price filter. A missing rating stays unless a minimum is set. The deck is either shuffled ("מעורב") or ordered nearest-first. Cuisine chips and the "N restaurants" count only include places that are open. If everything in range is closed, the screen says so instead of looking like a broken search. "קרוב אליי" asks the browser for a location and, if that is denied, the area list is still there.
- **Attribution:** every card and result shows the photo author (from Google's `authorAttributions`, https links only) and a Google wordmark plus "Maps". The footer says the app is not affiliated with Google, Wolt, or Waze.
- **Wolt:** `npm run wolt` searches Wolt's public, unauthenticated venue search (no API key) and writes `src/data/wolt-venues.ts`. The "הזמינו ב-Wolt" button is a direct venue page, and only for a place matched by name and distance. Everyone else has no button. Re-run the script after a new seed.

### Refresh within 30 days
Google's terms limit caching of Places content to about 30 days (place ids may be stored longer). **Re-run the seed before the file is 30 days old** with the button on `/stats` (at most 2 runs per UTC day). It also clears the photo cache. If the file is older than that, the app stops showing it and falls back to the demo list instead of serving stale Places data.

CLI alternative: `GOOGLE_PLACES_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed`. This writes `public/data/restaurants.json` and uploads both files to Storage.

### Expected cost
Per seed: **90 Nearby Search calls**, Enterprise SKU (rating, rating count, price, and opening hours — still one SKU, not Atmosphere). The seed does **not** call the photo endpoint, and the function allows at most **2 seeds per UTC day** (about 180 Nearby Search calls, under the 200/day quota in section 2). Photos: the first picture of each restaurant, plus up to 4 more **only if someone taps to them**, each cached for **30 days**. The photo function itself stops calling Google after **800 new fetches per UTC day**, so a script cannot walk the whole catalog in one burst. Set the Cloud console daily quotas in section 2 as well (those are the hard stop on Google's side; this repo cannot see that console). Keep the billing budget alert. The intention is to stay inside the free allowance. Check the current Maps pricing page, and do not attach any other paid API.

### Re-run the seed (hours + extra photos)
1. Apply `supabase/migrations/20261119140000_lock_down_public_access.sql` first, then deploy the `seed` and `photo` edge functions from this repo (JWT verification off, same as `supabase/config.toml`). The photo function must be the new one **before** you refresh, because it is what understands `&i=` and reads the private photo manifest.
2. Secrets, already set for the current app: `GOOGLE_PLACES_API_KEY` (Places API (New) only) and `ADMIN_PASSWORD`. No new secret.
3. Either open `/stats`, enter the admin password, and click **רענון נתונים מ-Google Places**, which `POST`s to `https://<project>.supabase.co/functions/v1/seed` with `{ "password": "<ADMIN_PASSWORD>" }`,
   or from a machine with the service role key: `GOOGLE_PLACES_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed`.
4. That is 90 Nearby Search calls. It rewrites public `data/restaurants.json` and private `data-private/restaurants.full.json`, deletes the old public manifest, and clears the photo cache. Reload the app afterward (the service worker cache name changes with the app, but a hard reload is the sure way).

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

- The creator's settings plus a **frozen deck** (the list of place ids, deterministically shuffled with seed `code:round`, or nearest-first when that sort was chosen) are stored in `sessions`. Everyone in the room sees the same cards in the same order.
- Up to **6 people** can join with the same link. That cap is the existing row-level check (`session_member_count < 6`); a 7th person sees "החדר מלא". No schema change.
- A place is a candidate when **both** people liked it, or, once 3 or more have joined, when a **strict majority** of the people in the room liked it (3 → 2, 4 → 3, 5 → 3, 6 → 4). The shortlist is still 1–3. One person tapping "סיימתי" does not end a larger group; a majority has to stop, or the shared list has to reach 5.
- New rooms use an **8-character** code (no ambiguous characters). A 4-character link from before this change still opens until that room expires. The share link is `/s/CODE`, with a WhatsApp button (text, not the WhatsApp logo) and a ready-made Hebrew message. No registration: each person is a random id kept in their browser, plus a secret token the database stores only as a hash.
- **Realtime:** Supabase Realtime on sessions, members and likes, with a 10s polling fallback and re-sync on reconnect, tab focus, or right after your own like. You see live friend progress ("החבר שלך בכרטיס 7 מתוך 40"), online/offline status, a match overlay with confetti, and "המשיכו לחפש".
- **Refresh-safe:** progress and likes are restored from the server, and matches you've already seen aren't shown again.
- If you both finish with no match: **"הרחיבו רדיוס"** (+1.5 km; at 5 km it drops the price and cuisine filters) or **"מתחילים מחדש"**. Both start a new round for both people.
- Sessions expire after **24h**: row security hides expired rooms, and they're deleted a day later.
- **Security:** the browser cannot read or write the room tables directly. It calls room functions that require the code, and writes also require that browser's token. Clients can never change `expires_at`. A room holds at most 6 members. Expired rooms are hidden immediately and deleted a day after they expire. `/stats` and the seed button need `ADMIN_PASSWORD`; eight wrong tries in 15 minutes lock the check for 15 minutes. Use a long random password. `track_event` only counts an allow-list of short names.

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
