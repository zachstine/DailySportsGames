# Community workflow verification

Verified on October 21, 2026 against the deployed GitHub Pages site and the existing Firebase project.

## Automated checks

The community release passed 63 automated tests, syntax and asset checks, and the static production build. Coverage includes all three single-game schemas, ambiguous/legacy import rejection, field-specific writes, revision conflicts, overwrite protection, live-content locking, submission limits, review/export/publication, and credit propagation without changing puzzle data or scores.

## Live browser and Firebase checks

- Submitted Player Guess, Stat Ladder, and CrossSport through the public forms without requiring a player account. All three persisted in the private review queue.
- Reordered Player Guess clues, previewed every game through the existing engine, completed Player Guess and CrossSport previews, and confirmed previews did not count as daily results.
- Verified crossword intersection errors, its solve timer, and creator credits on game headers and completion panels.
- Reviewed and edited suggestions, preserved original creator names privately, approved and rejected suggestions, copied approved game-specific JSON, and downloaded valid JSON.
- Imported all three approved games into one new date using separate writes. Each import retained existing other games and credits. Cancelled a Stat Ladder replacement with no changes; confirmed replacement and verified only Stat Ladder changed.
- Scheduled the complete test slate and confirmed all three linked submissions received Published status. Corrected a name through review and through the owner desk's credit-only action; all game content remained identical.
- Returned the test slate on **2099-12-29** to a **private draft**. The already edited **2099-12-30** slate was checked and preserved. Existing released puzzles were not modified for these tests.
- Verified the signed-out review page showed no submission data.

The Firestore Rules Playground, using the published rules, confirmed these simulated reads:

| Request | Result |
| --- | --- |
| Signed-out read of a community submission | Denied |
| Authenticated nonowner read of a community submission | Denied |
| Authorized owner read of a community submission | Allowed |
| Signed-out read of the scheduled October 22 slate | Denied |
| Signed-out read of the released October 21 slate | Allowed |

These simulations did not write database content. The new rules were already published; no additional indexes or paid Firebase services were needed.

## Remaining manual device checks

The cloud browser did not open a file chooser during the upload-control test. Approved JSON downloads validated, and the primary copy-and-paste import workflow passed end to end; selecting a local `.json` file still needs a normal-browser check. Use the checks in [TESTING.md](TESTING.md) for real iPhone/Android layout, keyboard, and native sharing verification.
