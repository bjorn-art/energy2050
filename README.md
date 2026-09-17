# New Energy 2050 (rewrite)

This is the ground-up rewrite of the energy asset investment simulation, replacing the old platform-based version. This README is written for Bjorn, who isn't a coder — it explains what's here, what already works, and exactly what to do next.

## What's in this folder right now (Phase 1 of the roadmap)

- `supabase/migrations/00000000000001_init.sql` — the full database design: markets, assets, financing/offtake options, narrative events, per-asset decision events, sessions, teams. This has been tested against a real local Postgres database and loads cleanly.
- `content/source/renewable-template-export.json` — a copy of the game data you uploaded, kept here so the import can be re-run any time.
- `scripts/import-template.ts` — a script that reads that export and turns it into `content/seed/seed.sql`, ready to load into a real database. This has already been run against your real data, and the result was checked back against the database line by line (markets, asset costs by year, production, event dependencies, and the per-asset decision choices all came out matching the original file exactly).
- `content/seed/seed.sql` — the ready-to-load result of that import: 1 template, 6 markets, 64 assets, 174 asset-level decision events, 31 broadcast events, and every year-by-year cost and production number that goes with them.
- `content/seed/photos/` — the event photos from your export, pulled out of the JSON into their own image files instead of being buried as text inside it.
- `app/`, `components/`, `lib/` — the skeleton of the actual web app: a home page, a placeholder facilitator console, and a placeholder team screen. These are intentionally bare for now; Phase 3 and 4 of the roadmap build them out.

## Getting this onto GitHub

This copy already has a git commit and `origin` pointed at `https://github.com/bjorn-art/energy2050.git` — nothing to configure, it just needs to be pushed from a machine you're logged into. Easiest: install **GitHub Desktop**, sign in, choose "Add local repository," and point it at this unzipped folder — it'll offer to publish/push right away. Or, if you're comfortable with a terminal: unzip this, open a terminal in the folder, and run

```
git push -u origin main
```

If it asks for a password, use a GitHub personal access token (Settings -> Developer settings -> Personal access tokens), not your account password — GitHub no longer accepts the latter for this.

## One important limitation of this session

This project was built inside a locked-down cloud sandbox that cannot reach the npm package registry (the place `next`, `react`, and other libraries get downloaded from). That means the code has been written and the database parts have been fully tested, but the web app itself (`npm install` / `npm run dev`) has not been run yet — there was nowhere allowed to install it. This isn't a sign of a problem with the code; it's a constraint of this particular sandbox. The first real install will happen automatically the moment this project is pushed to GitHub and connected to Vercel (Vercel's build servers have normal internet access), or whenever a future session has fewer network restrictions.

## What you need to do next: three free accounts

Nothing below requires coding. Do these in order, at your own pace, and let Claude know as you go — Claude can walk through each step with you, or take over the parts that don't need your personal login.

1. **GitHub** (github.com) — this is where the code lives permanently. This cloud session is temporary and gets cleared out eventually, so without GitHub this code has nowhere durable to live. Once you have an account, Claude can help create a repository and get this code into it.
2. **Supabase** (supabase.com) — this is the database. Free tier is enough for building and testing. Once you create a project there, Claude needs the project's URL and two keys (found under Settings -> API) to connect the app to it, and can then run the schema and seed file for real.
3. **Vercel** (vercel.com) — this is where the finished app actually runs online, so teams can open it in a browser during a live session. Vercel can connect directly to your GitHub repository and rebuild the site automatically every time the code changes.

You can sign up for all three with the same email if that's simplest.

## Phase 3 setup: the facilitator console

Two things need to happen once this code is on GitHub (Vercel will then rebuild automatically):

1. **Run the new database migration.** Open your Supabase project's SQL editor and paste in the contents of `supabase/migrations/00000000000002_phase3_sessions.sql`, then run it — same process as the very first schema file. It adds a couple of columns and one small table; it won't touch any of your existing data.
2. **Set a facilitator password.** In Vercel, go to your project's Settings -> Environment Variables and add `FACILITATOR_PASSWORD` with any password you choose (see `.env.example`). This is the password for `/facilitator` — without it set, that whole section shows a "not configured" message instead of letting anyone in.

Once both are done, `/facilitator` lets you create a session, add teams (each gets a join code — that's for Phase 4, when the team screens exist), and click "Advance year." Balances won't move yet, since investing doesn't exist until Phase 4 — this phase is about the session/team/event mechanics working end-to-end against the real database, which you can check by watching a session's year count go up and its "Year history" list fill in.

## Phase 4: the team app

No new setup step this time — the database table this needed (`team_investments`) was already part of the very first schema file, so there's nothing to run in Supabase. Just get the new/changed files onto GitHub (see the delivery message for exactly which ones) and Vercel rebuilds automatically.

What's new: a team opens `/play`, types the join code their facilitator gave them, and lands on their own screen — no password beyond the code itself. From there they can see the session's current market prices, their own portfolio, and a list of investable assets (with a financing choice and an offtake/PPA choice per asset, and an estimated capex figure so they're not investing blind). Clicking "Invest" records the choice and, if the asset has an access fee (`assets.minimum_access_cost`), charges that fee immediately. The capex/down-payment/loan/revenue/tax numbers still only get charged the next time the facilitator clicks "Advance year" — that's all still `lib/engine`'s job, unchanged from Phase 2/3.

Confirmed with Bjorn (2026-09-17), resolving the three judgment calls flagged after the first delivery:

- **Assets stay exclusive within a session** — once any team invests in it, it disappears from every other team's market. Keeping the simple first-come model rather than adding competitive bidding.
- **`assets.minimum_access_cost` is now charged as an immediate fee**, deducted from the team's balance the moment they click "Invest" (logged as its own `access_cost` transaction in `team_balance_history`, dated to the session's current year since it happens before the next year exists).
- **No affordability check, deliberately.** A team can still invest in something that will charge more than they can currently afford, and their balance can go negative once the facilitator advances the year (or now, immediately, from an access fee) — that's accepted as-is for now.

## Roadmap recap

1. **Foundations** (Phase 1) — schema, template import, repo scaffold. Done, live.
2. **Simulation engine** (Phase 2) — the price and financial math, independent of any screen. Done, reviewed with Bjorn.
3. **Facilitator console** (Phase 3) — create a session, add teams, advance years, see scheduled events fire. Done, live, verified end-to-end.
4. **Team app** (Phase 4, this delivery) — market view, investing, portfolio. This is what makes "Advance year" actually move money.
5. Events layer — wiring the broadcast and per-asset decision events (including CSR choices) fully into live gameplay.
6. Polish and a real pilot session.
