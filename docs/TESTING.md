# Demo test sheet

Run `npm run check`, `npm test`, and `npm run build` first. Then use this short friend-testing checklist against the deployed site. Automated game-logic tests don't substitute for a real Firebase/rules or mobile browser test.

## On a phone and a desktop

- Try widths around 360px, 390px, and a desktop screen. No horizontal scrolling, clipped controls, or tiny answer inputs. Phone inputs should not zoom the page.
- Play Player Guess: one wrong guess, one skip, then an accepted alias. Confirm the clues advance, score drops, and you can't submit after completion. Try all five wrong once in practice.
- Play Stat Ladder: miss a question, skip one, and get later ones right. Confirm the game continues and later questions carry more points. Try a perfect practice run.
- Refresh halfway through every game. Confirm progress remains. Open the same game in a new tab after saving and check it restores.
- CrossSport: tap a clue, enter a word, tap an intersection to switch direction, then try arrow keys and Backspace on desktop. Test pasting a whole word. Incorrect letters should be highlighted after Check grid; blank cells should remain unmarked.
- Reveal a letter, finish the crossword, and confirm the shared result reports the reveal and every grid check. Completing without reveals should say so.
- Open and close rules, stats, and share dialogs with keyboard and pointer. Escape should close dialogs. Keyboard focus should stay visible.
- Copy the result into a text editor or group chat. It should contain the correct game, date, score, and blocks, with no answer. On a supported mobile browser, try the native Share button; canceling it should be harmless.
- Practice should never add a daily streak. A finished daily game should add one completion for its date; refreshing shouldn't add another.
- In a private browser, progress should be separate. With browser storage blocked, game play should continue with a clear persistence message.
- With Firebase configured, simulate offline mode or a bad connection: the site should offer practice explicitly rather than silently substitute sample puzzles for the real daily game.

## Owner desk

- With blank Firebase config, local editing, draft saving, JSON export/import, and previews should work. Cloud save/publish should be disabled.
- Sign in with the owner account and load a new future date. Save a private draft. Reload it from the sidebar; all three games should match.
- Export the slate, change a clue, and import the exported copy. Check the date, questions, crossword, and aliases restore correctly. Load its date and confirm imported content stays in the editor.
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

`updatedAt` must be a server timestamp matching the request time. `unlockAt` is a Firestore timestamp computed by the owner editor for Eastern midnight. The owner is a trusted content author; the editor validates all game fields before writing, while rules enforce access, revision, release, immutability, and the top-level document shape. A malicious account with actual owner authorization is not a threat the client editor can prevent; remove its owner document in the Console if access must be revoked.

For rollover testing, use the emulator or a temporary separate development project. Avoid changing your computer clock or unlocking real future puzzles just to test: the browser and Firestore server have different clocks. Automated tests already cover Eastern dates and both daylight saving transitions.
