# Five-game slates and league editions

The site keeps its existing HTML/CSS/JavaScript, GitHub Pages hosting, Firebase Auth, and Firestore setup. Publish the updated `firestore.rules` before using league publishing or ranked Drills. No Cloud Functions, paid hosting, realtime leaderboard listener, or new billing plan is required by this release.

## Daily lineup

| Edition | Games |
| --- | --- |
| General | Player Guess → Stat Ladder → CrossSport → The “Grid”-iron → The Two Minute Drill |
| NFL, MLB, NBA, NCAAF | Player Guess → Stat Ladder → CrossSport |

Existing General dates with three games remain three-game dates. Their published answers and saved scores are retained. New General drafts include both additions by default; their Include checkboxes allow a gradual rollout. A released slate still locks its answers and clues.

## Owner workflow

1. Choose **Edition** at the top of the owner desk and a release date. The desk loads that edition's own content, local draft, revision, and schedule. The optional league edition is independent of General; publish each separately.
2. Prepare the original three games as usual. Empty sport fields in a new league draft default to that league.
3. For **The “Grid”-iron**, paste nine comma-separated names. Enter each square's stat/clue and choose its correct name. Every name must be assigned exactly once. The public bank is shuffled, and its order survives a refresh.
4. For **The Two Minute Drill**, enter the question and comma-separated answers. Optional aliases follow `|`: `Patrick Mahomes | Mahomes, Wes Welker | Welker`. Each comma starts a new answer, not an alias. Up to 500 answers are supported; ambiguous aliases shared by different answers fail validation. A single game must fit within 50 KB, and a slate within 150 KB.
5. Validate and **Preview this edition**, then save privately or publish/schedule. Future content releases at midnight Eastern. The public selector lists editions published for that date.

Single-game JSON exports from a league carry its league. Importing an explicitly labeled game into a different edition is rejected. Older exports without a league can be assigned to the selected edition. Community creation and review keep the original three games; imported suggestions can be assigned to a league. Linked creator corrections work across editions without modifying their puzzle content.

## Play, timing, scores, and sharing

- Grid-iron gives instant feedback and unlimited retries. Correct placements lock. Green shared squares mean a first-try match; yellow squares mean that square received a wrong guess. A complete grid scores 9/9, with a separate miss count.
- Drill gives one point for each unique accepted answer. Incorrect or repeated guesses do not remove points. Its 120-second deadline continues while hidden, on another game, or across a reload. Finding the entire bank finishes early. Practice can be reset; a daily completion stays locked.
- General and league progress, finished scores, local completion streaks, and working drafts are separate. General keeps its original storage keys and result IDs.
- Home, game results, Your stats, account totals, next-game links, and combined sharing support the games actually available in that edition. Combined sharing preserves the individual emoji patterns and adds one edition label and one link.

## Ranked Drill

Guests can play unranked. A Google or email/password player can choose a public nickname and start one ranked run per daily question. A server timestamp fixes the start; the client cannot replace it. Each accepted canonical answer is appended through a transaction. Rules reject unknown keys, duplicate answers, multiple new answers in one update, another user's run, and answers at or after the server deadline. On completion, the public total must equal the accepted answer count. Reloading resumes the same ranked clock. A pending leaderboard submission has a Retry control; it reconciles the final total before recording the immutable private result.

Only the selected nickname, answer count, and completion timestamp appear in a public score document. Emails and private result history are not exposed. The leaderboard queries the top 25 by answer count when opened, refreshed manually, or after submission. Ties share a place; no completion-time tiebreaker is used.

This is a friendly trivia leaderboard. Published puzzle documents contain answer banks so the browser can run the games. A determined player can inspect released answers or use another account. Server rules protect timing and accepted totals, not whether a person knew an answer unaided. Prize competitions would need a different design.

## Data layout and compatibility

| Purpose | Firestore path |
| --- | --- |
| Existing General puzzles | `dailyPuzzles/{date}` |
| League puzzle editions | `leaguePuzzles/{league}/days/{date}` |
| Published edition directory, without clues or answers | `dailyEditions/{date}` |
| Existing General private results | `results/{uid}_{date}_{game}` |
| League private results | `results/{uid}_{date}_{league}_{game}` |
| Private canonical Drill keys used by rules | `drillKeys/{date}` |
| Private ranked clock and accepted keys | `drillRuns/{date}/players/{uid}` |
| Public ranked score | `drillLeaderboards/{date}/scores/{uid}` |

Owner publication updates the edition directory and Drill keys in the same transaction as its puzzle. Publishing the first league edition also preserves an existing General edition in the directory. Removing a Drill from a future slate disables its ranked keys. Existing account roles, owner documents, original result IDs, and three-game community exports remain compatible. No data migration or composite index is needed for the shipped queries.

## Keeping the demo inexpensive

GitHub Pages continues to serve the static site. Firebase stays on Spark. A daily page fetches its edition directory and selected puzzle, then queries up to 25 private result documents for that player/date (the five editions currently have at most 17 games). Every completion adds one private result write. Ranked Drill adds one clock write, one update per unique correct answer, and one final public score write. Misses and duplicates do not write to Firestore. Rules and transactions also consume reads. No polling runs in the background.

Firestore's documented default free quota is 50,000 reads/day, 20,000 writes/day, and 1 GiB stored. Monitor usage as the audience grows; this is not a promise of unlimited usage. Sources: [usage and limits](https://firebase.google.com/docs/firestore/quotas), [index defaults](https://firebase.google.com/docs/firestore/query-data/index-overview), and [rules conditions and document reads](https://firebase.google.com/docs/firestore/security/rules-conditions).

## Verification

Run the dependency-free checks:

```sh
npm run check
npm test
npm run build
```

The optional integration suite uses a disposable **demo** emulator project and never the production database. Install QA dependencies in a temporary folder (production does not need them):

```sh
npm install --prefix /tmp/dsg-rules-qa --no-audit --no-fund firebase @firebase/rules-unit-testing firebase-tools@13.35.1
DSG_QA_ROOT=/tmp/dsg-rules-qa /tmp/dsg-rules-qa/node_modules/.bin/firebase emulators:exec --only firestore --project demo-dailysportsgames-upgrades --config firebase.json 'node --test tests/firestore.integration.mjs'
```

Firebase CLI 13 is used for this optional harness's Java 17 compatibility. Newer CLI versions require an appropriate newer Java runtime. The test file refuses to start without `FIRESTORE_EMULATOR_HOST`.

Automated coverage includes legacy slates and sharing, new game validation and scoring, aliases and duplicate answers, fixed deadlines, saved progress, per-league isolation, import/export routing, owner publication, live locks, future-release privacy, ranked answer rules, forged scores, private history, same-date cross-edition credit corrections, and removal of a future Drill. Browser QA covers desktop and a 390px iframe viewport, grid retries/reload, owner edition switching, Drill duplicate feedback/reload/expiry, and the final published static pages. Production backend activation requires publication of this release's rules.
