# Daily Sports Games

Five mobile-friendly General games and optional three-game league editions, built with HTML, CSS, and JavaScript. GitHub Pages serves the website; Firebase Authentication and Cloud Firestore power optional player accounts, a private puzzle review queue, and the owner puzzle desk. No production npm dependencies, paid sports API, Cloud Functions, or storage bucket are needed.

## Run it locally

Use Node.js 22 or later. Open this folder in VS Code, then run:

```sh
npm run dev
```

Open **http://localhost:3000**. The owner editor is at **http://localhost:3000/admin.html**. You can also use VS Code's Live Server. Open over HTTP, rather than double-clicking the HTML files, because the application uses JavaScript modules and fetch.

With `firebase-config.js` blank, the site offers a clearly labeled **practice slate**. All five General games, saved progress, score sharing, the local editor, JSON import/export, and previews work. Daily streaks and cloud publishing activate after Firebase is configured. There are no fake daily puzzles or fake streaks.

## The first-version rules

| Game | Mechanics | Result |
| --- | --- | --- |
| Player Guess | 5 clues, starting with a distinctive stat or career fact; later clues add context; one guess or skip per clue; 5 misses end the game | 5 points on clue 1, down to 1 on clue 5; 0 if unsolved |
| Stat Ladder | 5 questions, easy to hard; one guess each; a miss or skip still advances | Rungs worth 1–5 points, maximum 15 |
| CrossSport | Connected 5×5–11×11 mini crossword; sports phrases and player surnames | Active solve time, number of grid checks, number of revealed letters |

All daily games reset at **midnight America/New_York**, including daylight saving changes. Answers accept case, spacing, punctuation, and accent variations; alternate names must be included explicitly as aliases. Player Guess's opening clue should give a knowledgeable fan a real chance on the first guess: use a precise season statistic or distinctive career fact, then add supporting detail, career context, team/era, and a signature clue. Verify the season and numbers before publishing. Sources are required for Stat Ladder questions. Avoid vague season references like “2025–2026 NFL passing”: specify, for example, **2025 NFL regular season, passing yards**.

Each game and league edition has a **completion streak**: consecutive daily dates on which the player finishes that game, even with a zero score. This avoids treating Stat Ladder and CrossSport as binary wins. Streaks and unfinished progress stay in that browser, separated by player identity. Completed daily scores are also recorded in Firestore using a persistent guest identity or an optional Google/email account. Practice and owner previews never count or submit results. Shared results include no answers. CrossSport measures active solve time from opening the crossword until completion. The timer pauses on other games and hidden tabs, resumes after refresh, and includes its final time with checks and reveals in the shared result. Timer checkpoints stay local; only the completed daily time is sent to Firestore. Older completed puzzles have no invented time. Your stats shows today's points or crossword solve time alongside completion streaks. Once all games in the selected edition are finished, **Share all scores** on the home screen or a completed game sends one compact text with all of that edition’s scores, crossword time/checks/reveals, and one game link. The share dialog supports copying and the phone's native share menu; it never includes answers.

If today's slate hasn't been published, the home page shows clearly labeled practice games and a button to check for the daily slate. Practice scores are kept separate. The owner must publish a slate for every daily date.

## Where the data lives

| Data | Location |
| --- | --- |
| Drafts and published daily slates | Firestore `dailyPuzzles/{YYYY-MM-DD}` |
| Owner publishing permission | Firestore `owners/{Firebase Auth UID}` with `enabled: true` |
| Community suggestions and private review | Firestore `submissions/{auto ID}` |
| Per-player suggestion limits | Firestore `submissionLimits/{Firebase Auth UID}` |
| Public creator names | Optional `credits` map on the dated Firestore slate |
| Registered player membership | Firestore `users/{Firebase Auth UID}` with immutable `role: "user"` |
| Completed daily scores | Firestore `results/{player UID}_{date}_{game}` |
| Partial progress, streaks, practice scores, and retry queue | This browser's local storage |

Each online result contains the player UID, date, game, score, server completion timestamp, crossword assistance counts, and an optional crossword `elapsedMs` duration. It contains no email, answer, or guess text. Owners can read all results; players can read/query only their own records. Results cannot be updated or deleted by the client. Failed submissions remain queued locally and retry when the daily site opens, the connection returns, or the player presses **Retry score recording**. Clearing browser data removes guest access, local progress, and unsent records. Registered players can sign in again to restore today's completed totals, but individual guesses, grid letters, and the full streak history remain local. Scores are not a trusted leaderboard.

## Optional player accounts

Open **Account / Sign in** from the game header, or `account.html`. Guests can play every game without a form. The account page offers Google, email/password sign-in, email/password signup, password reset, and a private view of today's saved scores.

- A new email account links to the current guest UID. Google also tries to link the current guest. Successful linking keeps the guest's completed scores and local progress.
- If Google credentials already belong to another account, sign-in opens that existing account. Email **Sign in** also opens the existing account. Guest and account records stay separate; the MVP does not merge two existing identities.
- Each registered account provisions its own `users/{uid}` document with `role: "user"` and a server creation time. Email and provider details stay in Firebase Authentication. Clients cannot promote themselves to an owner or change roles.
- Signing out returns to a fresh guest. Account progress and retry queues remain isolated from the next player on that browser. Owner publishing uses a separate Firebase app session and the manually managed `owners` list.
- Today's saved scores load from the account on another device and lock finished games. Restored totals share without inventing individual guess outcomes or revealed-cell locations. Full cross-device streak history and unfinished-game syncing are outside this MVP.

## Connect and deploy

Follow **[docs/SETUP.md](docs/SETUP.md)** for Firebase, owner access, Firestore rules, GitHub Pages, and your first published slate. The repository includes a GitHub Actions workflow that validates, tests, builds, and deploys `dist/` on pushes to `main` after Pages is enabled.

The free demo uses a public repository with GitHub Pages and the Firebase **Spark** plan. Keep the Firebase project on Spark to avoid usage charges. If you exhaust no-cost quotas, service availability can be limited; Spark does not automatically upgrade to paid billing. Do not attach a billing account just for this MVP.

## Community puzzles and owner workflow

Open **`create/`** from **Create a Puzzle** on the home page. Friends choose Player Guess, Stat Ladder, or CrossSport, fill a game-specific form, preview the actual game, and submit for private review. No account form or JSON knowledge is required. Anonymous play and owner sign-in remain separate.

1. Sign in through **`admin.html`** with the owner account. Open **Review submissions** (`admin/submissions/`). Only the existing `owners/{uid}` permission grants access.
2. Review the proposed name and puzzle. Edit the public name and content, preview, then **Approve**. Approval does not publish anything. Copy or download the approved game JSON.
3. At the owner desk choose a date and **Load date**. Paste the approved JSON or upload the one-game file. **Import game to this date** saves only that game and its creator credit. Existing slots require a confirmation naming the game and date; stale revisions are rejected.
4. Import the other two games for the same date. Missing games remain blank in a private draft; existing games and unsaved edits to other games are retained. A single-game import never replaces the entire puzzle map.
5. Validate and preview the complete slate, then **Publish / schedule slate**. The original three games are required; new General drafts also include Grid-iron and the Drill, with Include checkboxes for a gradual rollout. A future slate releases at Eastern midnight; released puzzle content stays locked.
6. Correct a creator name at any time using **Save creator names only**, or save the approved name in submission review. Linked public credits update without changing a live answer or clue. Original submitted names remain private in the review queue.

The owner desk now exports **one selected game** at a time. Older full-slate JSON backups are rejected by the single-game importer rather than silently replacing three games. Existing General slates, scores, local game keys, and player accounts remain compatible; no data migration is needed. League exports identify their edition.

See **[docs/COMMUNITY.md](docs/COMMUNITY.md)** for schemas, privacy rules, rate limits, and deployment details. Valid examples are in **[docs/examples](docs/examples)**; they reuse the existing sample puzzles and are not published automatically.

## Checks

```sh
npm run check
npm test
npm run build
```

The tests cover scoring, guess limits, aliases, crossword geometry, sharing, refresh persistence, queued result retries, duplicate submissions, account isolation, guest linking, restored totals, date changes, streaks, storage failures, and daylight saving transitions. `check` verifies JavaScript syntax, local HTML assets, duplicate IDs, JSON, and the example slate. `build` creates a static hosting allowlist in `dist/` and versions local scripts, their imports, and styles together to prevent stale modules after deployment.

Browser/device QA and Firebase rules tests need the manual checks in **[docs/TESTING.md](docs/TESTING.md)**. The completed community workflow checks and remaining device checks are recorded in [docs/QA.md](docs/QA.md). This code has no authenticated server-side answer checking: a technically inclined player can inspect the answers to an available puzzle in browser developer tools. Future Firebase puzzles remain protected by read rules, but this is a friendly demo, not a prize competition or trusted leaderboard.

## Project layout

- `index.html`, `css/styles.css`, `js/app.js`: public game hub and games.
- `admin.html`, `css/admin.css`, `js/admin.js`: puzzle desk and local previews.
- `account.html`, `css/account.css`, `js/account.js`: optional player sign-in and today's private score summary.
- `js/core.js`: game rules, crossword validation, dates, streak calculations, sharing.
- `js/storage.js`: local progress, drafts, and previews.
- `js/firebase.js`, `firebase-config.js`: lazy-loaded Firebase browser integration.
- `firestore.rules`, `firebase.json`: owner access and scheduled read protections.
- `create/`, `admin/submissions/`, `js/game-editor.js`, `css/community.css`: public creation and private owner review.
- `js/puzzles.js`, `js/community.js`: single-game imports, approvals, credits, and submission transactions.
- `data/practice.json`: bundled practice slate.
- `docs/COMMUNITY.md`, `docs/examples/`: submission workflow, single-game schemas, and valid examples.
- `.github/workflows/pages.yml`: continuous checks and Pages deployment.

References: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [Firestore quotas](https://firebase.google.com/docs/firestore/quotas), [Firebase web setup](https://firebase.google.com/docs/web/setup), [Firestore security conditions](https://firebase.google.com/docs/firestore/security/rules-conditions).

## New games and league editions

General now supports **The “Grid”-iron** (nine stats matched to a nine-name bank) and **The Two Minute Drill** (unlimited guesses in 120 seconds, with a signed-in daily leaderboard). Optional **NFL, MLB, NBA, and NCAAF** editions offer the original three games with independent content, progress, scores, and streaks. The Drill is last in the General lineup. The owner desk switches its entire working context by date and edition.

Read [the upgrade guide](docs/UPGRADES.md) for the owner workflow, comma-separated answers and aliases, leaderboard privacy, compatibility, cost controls, and optional Firestore emulator tests. **Publish the updated Firestore rules before using league publishing or ranked Drills.** Existing published General games continue to work.
