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

## Roadmap recap

1. **Foundations** (this delivery) — schema, template import, repo scaffold.
2. Simulation engine — the price and financial math, independent of any screen.
3. Facilitator console — create a session, advance years, trigger events.
4. Team app — market view, investing, portfolio.
5. Events layer — wiring the broadcast and per-asset decision events into live gameplay.
6. Polish and a real pilot session.
