# Connect Firebase and launch the demo

## 1. Create the Firebase project

In the [Firebase Console](https://console.firebase.google.com/), create a project for **DailySportsGames**. Use the **Spark / no-cost** plan and skip Analytics for this demo. You do not need a billing account.

1. Add a **Web** app from Project settings.
2. Copy its `firebaseConfig` object into the root `firebase-config.js` file. At minimum, fill in `apiKey`, `authDomain`, `projectId`, and `appId`. Extra standard config fields from Firebase are fine.
3. This is public web app configuration. Never put a service-account JSON file, Admin SDK private key, or owner password in the repository.
4. Under **Build → Firestore Database**, create the **default Standard edition** database. Choose an appropriate US region and start in **production mode**. Do not enable public test rules.
5. Open **Firestore → Rules**, replace the rules with the complete contents of `firestore.rules`, and click **Publish**.

The website's code is pinned to the modular Firebase web SDK 13.0.0 and downloads it from Google's CDN only when configured. There is no Firebase npm installation required for the web app.

## 2. Create your owner login

1. Under **Authentication → Sign-in method**, enable **Google** for the owner and choose the project's support email. You may also enable **Email/Password** if you prefer that login. Phone login isn't needed.
2. Open `admin.html` and sign in with Google. This creates your Firebase Auth account without giving it publishing access. Alternatively, create an Email/Password user under **Authentication → Users → Add user** and sign in with it.
3. Copy that user's **UID**.
4. In Firestore, create a collection named `owners`. Create a document whose **document ID is exactly that UID**. Add one field: `enabled`, type **boolean**, value **true**.
5. Under **Authentication → Settings → Authorized domains**, add `zachstine.github.io` and `localhost` if needed. If the repository is moved, use the actual hosting hostname. Add the hostname only, not `https://` or a path.

Only the Firebase Console (or a trusted admin environment) can add owners. Website visitors cannot add or edit owner documents. Knowing someone's email is not enough to obtain publishing access.

Under **Authentication → Sign-in method**, also enable **Anonymous** for guest score recording. This lets each browser submit its own completed daily scores without a signup form. It does not grant publishing access. The deployed `firestore.rules` must include the restricted `results` collection rules from this repository. The owner login and guest identity use separate Firebase app instances, so owner sign-in doesn't replace a player's guest identity.

For optional player accounts, enable **both Google and Email/Password**. The public `account.html` page uses these providers in the player app session. Registered players create their own private `users/{uid}` profile containing only `role: "user"` and `createdAt`; no manual user-group provisioning is needed. Publish the `users` rules and player-scoped result query rules from `firestore.rules` as well. User membership does not grant owner publishing permission.

New email signups link to their guest UID. Google tries linking first; if its credential belongs to an existing account, that account opens with its own record. Signing into an existing email account also keeps histories separate. Do not copy or delete guest documents to force an account merge.

## 3. Bring the files into your VS Code project

These changes are committed to the GitHub repository. In the local DailySportsGames project, pull `main` before editing the config:

```sh
git pull origin main
```

If Git reports uncommitted or conflicting local files, save those changes before pulling. Do not force-reset the local project. For a fresh clone instead:

```sh
git clone https://github.com/zachstine/DailySportsGames.git
cd DailySportsGames
```

Paste your Firebase config, then test locally:

```sh
npm run dev
```

Use http://localhost:3000/admin.html, sign in, and confirm the **OWNER CONNECTED** badge. If your account isn't authorized, the page shows the UID to compare with the Firestore owner document.

## 4. Publish your first slate

1. In the owner desk, choose today's Eastern date and click **Load date**. The sample is a starting point; replace the content for your actual daily puzzle.
2. Enter all clues/questions and aliases. For crossword coordinates, the editor starts at row 1 / column 1; JSON uses zero-based coordinates.
3. Click **Validate slate**, then **Preview all three games**. Play through the games. Return to the owner desk; the working copy was saved locally.
4. The desk remembers your date, working copy, and loaded revision when returning from preview. **Load date** intentionally reloads the cloud draft, so export a local working copy before replacing it. A stale revision is rejected if another editor has saved changes.
5. Click **Save Firebase draft** to keep the slate private, or **Publish / schedule slate** to release it on its selected date.
6. A puzzle for today releases immediately. A future one unlocks at midnight Eastern. Released, published slates lock against edits to preserve everyone's daily results. Always preview before publishing.

You can prepare any number of future dates. The sidebar shows the next 14 saved dates from today onward. The game fetches only the current day's single document. There are no cron jobs or scheduled Cloud Functions.

## 5. Enable free GitHub Pages hosting

Open [DailySportsGames → Settings → Pages](https://github.com/zachstine/DailySportsGames/settings/pages).

1. Under **Build and deployment**, set **Source** to **GitHub Actions**.
2. Commit and push `firebase-config.js` to `main` when ready:

```sh
git add firebase-config.js
git commit -m "Connect Firebase web app"
git push origin main
```

3. Open **Actions → Test and deploy Daily Sports Games**. Wait for both **verify** and **deploy** to turn green. If a run happened before Pages was enabled, rerun it after changing the source.
4. Open the Pages URL shown by the deployment. For this repository, the expected URL is **https://zachstine.github.io/DailySportsGames/** and the owner desk is **https://zachstine.github.io/DailySportsGames/admin.html**.

The Pages URL works as a practice demo before Firebase is configured. Treat the URL as live only after GitHub confirms a successful deployment. New source commits update the site automatically. Owner puzzle uploads go straight to Firestore and need no code deployment.

## 6. Confirm the database writes

Publish a slate for today, open the public home page, and confirm the edition says **THE DAILY SLATE**. Complete a game and look for **Result recorded online** on its result screen. In **Firestore → Data**, you should see:

- `dailyPuzzles`: the slate saved by the owner desk.
- `owners`: your publishing authorization document.
- `results`: one document per completed daily game and guest identity, with score, date, game, `completedAt`, and crossword checks/reveals.
- `users`: one private `role: "user"` profile per registered player. Email and provider details are available under **Authentication → Users** rather than duplicated in Firestore.

Refresh the completed game: its score and one-day streak should remain, and it should not create another result document. A missing slate displays **PRACTICE SLATE** instead; practice and previews do not write scores to Firestore. Previously completed practice games cannot be converted into real daily results.

If a daily result says online recording is unavailable, verify Anonymous sign-in is enabled and the latest rules are published. The score remains local and queued for retry. Existing genuine daily completions can retry from the same browser. Registered accounts can restore today's submitted totals after signing in on another device; unsent scores, unfinished games, and the full streak history remain local.

Open the Account page as a guest and check today's saved totals. Sign in, then confirm its account's separate totals appear. Sign out and confirm fresh guest play is still available. A player cannot grant themselves owner access by editing their profile.

If you use a different GitHub account later, update the clone and setup links, hosting hostname in Firebase, and the URL you share. All in-app asset links are relative, so the code supports a repository subpath.

## Costs and scope

The target is **$0/month** for this friend demo: public GitHub Pages, Spark Firestore, Google/Email Authentication, and anonymous guest authentication. Firestore's free quotas include **50,000 document reads/day**, **20,000 writes/day**, and **1 GiB of storage** for the default free database. Watch actual usage in the Firebase Console. A page load reads one daily puzzle document shared by all three games and queries at most three saved daily totals, without a live listener. Registered profile checks, rule checks, and duplicate retries also use reads. Each completed game adds a result write; each new registered player adds one profile write. Owner operations read additional documents for authorization and scheduling.

Keep the project on Spark for the demo. Quota exhaustion can stop Firebase operations instead of increasing a bill. Cloud Functions, a Cloud Storage bucket, paid sports APIs, syncing unfinished games, and a trusted leaderboard are outside this version. JSON “upload” means reading a local file in the browser and writing a validated Firestore document; it doesn't use Cloud Storage.

Reference: [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [Firestore quotas](https://firebase.google.com/docs/firestore/quotas), [Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).


## Community creator and private review

The public creator is at `create/`; the private owner review page is at `admin/submissions/`. Both are included in the Pages build. No new Firebase provider, billing plan, Cloud Function, or paid service is required. Existing Anonymous Authentication and the owner list are reused.

Publish the updated `firestore.rules` from this repository before enabling the creator. These rules add private `submissions`, per-UID `submissionLimits`, partial private daily drafts, and owner-only credit corrections. Never use temporary public read/write rules. Existing `dailyPuzzles`, `results`, `owners`, and `users` documents need no migration.

Review loads 50 suggestions at a time ordered by creation time and applies its game/status filters to loaded suggestions. **Load older submissions** includes earlier pages. This uses the automatic single-field index; no composite index setup is required.

See [COMMUNITY.md](COMMUNITY.md) for the one-game JSON contract and the review → copy → import → schedule workflow.
