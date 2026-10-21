# Demo test sheet

Run `npm run check`, `npm test`, and `npm run build` first. Then use this short friend-testing checklist against the deployed site. Automated game-logic tests don't substitute for a real Firebase/rules or mobile browser test.

## On a phone and a desktop

- Try widths around 360px, 390px, and a desktop screen. No horizontal scrolling, clipped controls, or tiny answer inputs. Phone inputs should not zoom the page.
- Play Player Guess: one wrong guess, one skip, then an accepted alias. Confirm the clues advance, score drops, and you can't submit after completion. Try all five wrong once in practice.
- Play Stat Ladder: miss a question, skip one, and get later ones right. Confirm the game continues and later questions carry more points. Try a perfect practice run.
- Refresh halfway through every game. Confirm progress remains. Open the same game in a new tab after saving and check it restores.
- CrossSport: tap a clue, enter a word, tap an intersection to switch direction, then try arrow keys and Backspace on desktop. Test pasting a whole word. Incorrect letters should be highlighted after Check grid; blank cells should remain unmarked.
- Open CrossSport and watch the elapsed timer. Switch to another game or hide the tab, then return: away time must not count. Refresh halfway through: the timer must resume from the saved elapsed time. Complete the grid: the final time must stop and appear in the result, share text, account totals, and daily stats.
- Open Your stats after an 8/15 Stat Ladder and a zero-point daily game. Today's score must show the actual points (including 0), with streak and days-played counts in separate columns. Unplayed games show a dash; practice must not replace daily scores. Older completed crosswords should say Complete without inventing 00:00.
- Reveal a letter, finish the crossword, and confirm the shared result reports the reveal and every grid check. Completing without reveals should say so.
- Open and close rules, stats, and share dialogs with keyboard and pointer. Escape should close dialogs. Keyboard focus should stay visible.
- Before completing all three games, the home screen's Share all scores button should be disabled. Finish all three in any order: the button must enable on the home screen and appear after CrossSport (and other completed games). Both entry points must open the same compact text containing all three actual scores, crossword time/checks/reveals, one date, and one link. Copy all scores must copy the entire text. Reopen a single-game share afterward: its title, Copy score label, and content must reset correctly.
- Copy the result into a text editor or group chat. It should contain the correct game, date, score, and blocks, with no answer. On a supported mobile browser, try the native Share button; canceling it should be harmless.
- Practice should never add a daily streak. A finished daily game should add one completion for its date; refreshing shouldn't add another.
- In a private browser, progress should be separate. With browser storage blocked, game play should continue with a clear persistence message.
- With Firebase configured, simulate offline mode or a bad connection: the site should offer practice explicitly rather than silently substitute sample puzzles for the real daily game.
- On an unpublished date, the home page should show the practice cards, a **PRACTICE SLATE** label, a notice explaining the missing daily slate, and **Check for today's games**. Finishing these games must not add a daily streak or Firestore result.
- Finish a real daily game. The result must say **Result recorded online**, and Firestore `results` must contain one document for that guest/date/game. Score, checks, and reveals should match. The record should contain no answer or guess text.
- Refresh, reopen the finished game, and retry recording. The same result document and original server completion time should remain. Move to the next game before the first score finishes recording: its input must stay intact.
- Disconnect after loading a daily slate, then finish it. The result should remain local with a retry message. Reconnect or reopen the daily page and confirm the pending result reaches Firestore once. Practice and preview completions must never enter this queue.
- Sign in/out of the owner desk, then return to the game site. Guest score identity and local progress should remain separate from the owner login.

## Player accounts

- Open Account as a guest. All three games must remain playable without submitting a sign-in form. Previously recorded guest scores should appear in today's saved totals.
- Create a new email/password account from the guest. Its UID, completed scores, and local daily progress should remain the same; Firestore should gain `users/{uid}` with `role: "user"` and a server creation time.
- Try Google with a new credential, then an existing one. New credentials should link the guest. Existing credentials should open that account's separate record without deleting the guest or overwriting account scores.
- Sign into an existing email/password account. Guest progress, streak records, and pending submissions must not appear as that account's results.
- Sign out, then play as a fresh guest. The signed-out account's email, completed scores, and pending writes must not remain in the guest UI. The separate owner desk session should remain unchanged.
- Keep a game tab and a second account tab open during sign-in/out. Within a few seconds, both should refresh into the new player session and show only that player's progress, even if Firebase delays its background-tab auth event.
- Sign into the same account on another device. Today's submitted totals must restore and lock completed games. The site must not invent individual guesses or revealed-cell locations when only a total is available.
- Cancel Google sign-in or enter an invalid password. Keep the current guest's saved progress and show a useful error. Verify the password field clears and no password is saved in local storage or Firestore.
- Test Forgot password with an account you control; the UI should give a generic inbox message. Test account tabs, Enter submission, and arrow-key navigation.

## Owner desk

- With blank Firebase config, local editing, draft saving, JSON export/import, and previews should work. Cloud save/publish should be disabled.
- Sign in with the owner account and load a new future date. Save a private draft. Reload it from the sidebar; all three games should match.
- Export a selected game, change a clue, and import the copy into a loaded future date. Confirm the replacement dialog names the game and date, and the other two games and their credits remain intact. Import the three games one by one into a new date; all three must coexist.
- Import malformed JSON, a file larger than 60 KB, or a conflicting crossword. The editor should keep its previous content and show the issue.
- Make two entries cross with mismatched letters, put an answer outside the grid, add an unclued touching word, and create a disconnected word. Validation should reject each before saving.
- Load a future date, edit it, then preview from the owner desk and complete a game. It should say Owner preview and leave daily streaks unchanged. Return to the desk; the same date, working copy, and loaded revision should be restored.
- Schedule a future date. Its sidebar status should say Scheduled. Open two owner tabs, load the same draft in both, save in one, then save in the other: the second must report a revision conflict.
- Publish a slate for today. It should become playable in a signed-out browser; a page refresh should retain completed results. The owner UI and rules should prevent editing the now-live published document.

## Firestore Rules Simulator / emulator

Use Firebase's authenticated and unauthenticated rule simulations (or the Emulator Suite) to verify the deployed rules. **Do this before inviting friends to the Firebase-backed daily game.** Use representative documents for a past/live published slate, a future published slate, and a private draft. Owner test requests must use the exact UID whose `owners/{uid}` document has `enabled: true`.

| Request | Expected |
| --- | --- |
| Signed-out visitor: get a released, published daily document | Allow |
| Signed-out visitor: get a future scheduled daily document | Deny |
| Signed-out visitor: get a private draft, even with a past unlockAt | Deny |
| Signed-out visitor: list dailyPuzzles | Deny |
| Signed-out visitor: write any puzzle or owner document | Deny |
| Signed-in nonowner: publish or list drafts | Deny |
| Signed-in user: get their own owner document | Allow read only |
| Signed-in owner: get any puzzle; list upcoming documents | Allow |
| Signed-in owner: create a valid draft with revision 1 and matching updatedAt/UID | Allow |
| Signed-in owner: update a future/draft document with revision incremented by 1 | Allow |
| Signed-in owner: update a released, published document | Deny |
| Signed-in owner: update without a revision increment or with mismatched date/UID | Deny |
| Anyone using the client SDK: create/update/delete an owners document | Deny |
| Signed-out visitor: create or read a result | Deny |
| Anonymous guest: create a correctly shaped result for their UID and a released daily slate | Allow |
| Player: create a crossword completion with nonnegative integer elapsedMs, or a legacy result without elapsedMs | Allow |
| Player: attach elapsedMs to another game, or use a negative/fractional duration | Deny |
| Anonymous guest: create a result for someone else's UID, a future slate, or a missing slate | Deny |
| Anonymous guest: create a result with out-of-range score, extra fields, or a client completion timestamp | Deny |
| Anonymous guest: get their own result | Allow |
| Anonymous guest: get another guest's result or query without a playerId filter | Deny |
| Player: query only their own results with a limit of 120 or less | Allow |
| Player: query someone else's results or use an unbounded query | Deny |
| Owner: read/list completed results | Allow |
| Anyone using the client SDK: update/delete an existing result | Deny |
| Registered player: create their own `users/{uid}` with only role=user and a server createdAt | Allow |
| Anonymous guest: create a registered user profile | Deny |
| Player: create another person's profile, set role=owner, or add extra profile fields | Deny |
| Player: read their own profile | Allow |
| Player: read another player's profile or list users | Deny |
| Anyone using the client SDK: update/delete a user profile | Deny |

`updatedAt` and result `completedAt` must be server timestamps matching the request time. `unlockAt` is a Firestore timestamp computed by the owner editor for Eastern midnight. Result document IDs must be `{auth UID}_{date}_{game}`; duplicate attempts cannot overwrite an accepted result. The owner is a trusted content author; the editor validates all game fields before writing, while rules enforce access, revision, release, immutability, and the top-level document shape. A malicious account with actual owner authorization is not a threat the client editor can prevent; remove its owner document in the Console if access must be revoked. Client scores are appropriate for this friendly demo and are not server-verified for competitive play.

For rollover testing, use the emulator or a temporary separate development project. Avoid changing your computer clock or unlocking real future puzzles just to test: the browser and Firestore server have different clocks. Automated tests already cover Eastern dates and both daylight saving transitions.


## Community workflow

- Create each of the three game types at `create/`. Reorder Player Guess clues and Stat Ladder questions. Build a connected crossword with both directions; try a conflicting intersection and an unclued touching word. Preview must use the existing engine and return to the saved draft. Reopening a preview should start a fresh test.
- Submit each valid game as a guest. Confirm a Firestore `submissions` document with a random ID, original name, canonical puzzle JSON, server time, `pending` status, and player UID. Confirmation must never publish or replace a daily puzzle.
- Submit again within a minute, then try more than five suggestions in 24 hours. The paired limit/submission transaction must be denied; the browser draft must survive.
- Open `admin/submissions/` signed out or as a nonowner. No queue or answers should load. Owner sign-in should reveal the queue; game/status filters and older pages must work. Signing out must clear the private details from the UI.
- Edit a proposed name and puzzle, save/approve, then copy/download. Export must contain exactly one game, only the approved name, and the submission ID. Original submitted name/content must remain private and unchanged. Reject an invalid suggestion without needing to parse its original JSON.
- Import the approved player, ladder, and crossword into one unused future QA date. Check the actual Firestore document after every import. Replace only Stat Ladder with explicit confirmation; the Player Guess/CrossSport fields, creator credits, and publication settings must be byte-for-byte equivalent.
- Keep unsaved edits to a different game while importing one slot. Those edits must remain in the editor and local draft, without entering the per-game Firebase write. A stale revision must fail before overwriting a newer date.
- Publish/schedule the completed QA slate; linked suggestions should become Published with the assigned date. A public read before its release must be denied. Return the QA date to a private draft after the test.
- Correct an approved public name through review and the owner credit-only action. Verify linked credits update and original names remain private. Simulate a released slate: credit-only updates should pass, while any answer/clue or release-setting change must fail.
- Check credited game headers and completion panels in preview and released play. Try HTML/script characters and overlength names: reject them; never interpret any submitted text as markup. No name means the normal title without a credit.
- Recheck today's original slate, optional login, daily results, streaks, crossword timing, and individual/combined sharing. This feature must not change existing live puzzle content or stored results.

Additional rule simulations: signed-out and nonowner reads/listing of submissions must fail; public review/status edits must fail; creating a submission without its atomic matching limit update must fail; resetting/deleting a limit or bypassing its cooldown/quota must fail. Only owners may edit review fields, creator credits, or game assignments.
