import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BASE_GAMES as GAMES, GAME_FIELDS, validatePuzzle } from "../js/core.js";
import { gameEnvelope, parseGameImport, validateGameImport, mergeGameIntoSlate, exportGameFromSlate, validCreatorName, samePuzzleData } from "../js/puzzles.js";
import { importOwnerGame, persistOwnerSlate, saveOwnerCredits, submitCommunityPuzzle, saveSubmissionReview, rejectSubmission, submissionEnvelope } from "../js/community.js";

const sample = JSON.parse(readFileSync(new URL("../data/practice.json", import.meta.url)));
const future = "2032-10-25";
class Stamp { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } }
const SERVER = Symbol("server-time"), DELETE = Symbol("delete-field");
const clone = value => value instanceof Stamp ? new Stamp(value.ms) : Array.isArray(value) ? value.map(clone) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clone(v)])) : value;
function fixture() {
  const data = new Map(), writes = [], reads = []; let sequence = 0;
  const ref = path => ({ path, id: path.split("/").at(-1) });
  const resolve = value => value === SERVER ? new Stamp(Date.now()) : value instanceof Stamp ? clone(value) : Array.isArray(value) ? value.map(resolve) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v)])) : value;
  const connection = { db: {}, data, writes, reads, auth: { currentUser: { uid: "owner-123" } }, store: {
    doc: (...args) => args.length === 1 ? ref(`${args[0].path}/suggestion-${++sequence}`) : ref(`${args[1]}/${args[2]}`),
    collection: (_db,path)=>({path}), serverTimestamp: ()=>SERVER, deleteField: ()=>DELETE, Timestamp: { fromMillis: ms=>new Stamp(ms) },
    runTransaction: async (_db, callback)=>{
      const pending=[];
      const result=await callback({
        get: async reference=>{ assert.equal(pending.length,0,"All transaction reads must precede writes");reads.push(reference.path);const value=data.get(reference.path);return { id:reference.id, exists:()=>Boolean(value), data:()=>clone(value) }; },
        set: (reference,value)=>pending.push({kind:"set",path:reference.path,value}),
        update: (reference,value)=>pending.push({kind:"update",path:reference.path,value})
      });
      for(const op of pending){
        const next=op.kind==="set"?{}:clone(data.get(op.path));assert.ok(next);
        for(const [key,value] of Object.entries(op.value)){
          const parts=key.split(".");let target=next;for(const part of parts.slice(0,-1))target=target[part]||=( {} );
          if(value===DELETE)delete target[parts.at(-1)];else target[parts.at(-1)]=resolve(value);
        }
        data.set(op.path,next);writes.push(op);
      }
      return result;
    }
  } };
  return connection;
}
const envelope = (game,name="Joe123",id)=>gameEnvelope(game,sample[GAME_FIELDS[game]],name,id);

test("each single-game JSON round-trips with its credit and rejects full-slate or ambiguous imports",()=>{
  for(const game of GAMES){const value=envelope(game);assert.deepEqual(parseGameImport(JSON.stringify(value)),value);assert.deepEqual(validateGameImport(value),[]);}
  assert.throws(()=>parseGameImport(JSON.stringify(sample)),/full-slate backup/);
  assert.throws(()=>parseGameImport(JSON.stringify({...envelope("player"),statLadder:sample.statLadder})),/full-slate backup/);
  assert.throws(()=>parseGameImport(JSON.stringify({...envelope("player"),game:"unknown"})),/Choose Player Guess/);
  assert.throws(()=>parseGameImport(JSON.stringify({...envelope("player"),date:future})),/unexpected field/);
  assert.throws(()=>parseGameImport(JSON.stringify({...envelope("player"),submissionId:123})),/submission ID/);
  assert.equal(validCreatorName('<script>alert(1)</script>'),false);assert.equal(validCreatorName("Joe_123"),true);
});

test("per-game merge retains the other two games and credits, without mutating the source",()=>{
  const original={...sample,date:future,credits:{player:{displayName:"Original"},cross:{displayName:"CrossAuthor"}}};
  const before=clone(original);const merged=mergeGameIntoSlate(original,envelope("ladder","Sarah45"),future);
  assert.deepEqual(original,before);assert.deepEqual(merged.playerGuess,before.playerGuess);assert.deepEqual(merged.crossSport,before.crossSport);
  assert.deepEqual(merged.credits.player,before.credits.player);assert.deepEqual(merged.credits.cross,before.credits.cross);
  assert.equal(exportGameFromSlate(merged,"ladder").creatorCredit,"Sarah45");
  assert.ok(samePuzzleData({a:1,b:2},{b:2,a:1}));
});

test("three Firebase imports coexist on one date and use field updates rather than replacing its puzzle map",async()=>{
  const client=fixture();let revision=0;
  for(const [game,name] of [["player","Joe123"],["ladder","Sarah45"],["cross","SportsFan22"]]){
    const result=await importOwnerGame(client,future,envelope(game,name),revision);revision=result.revision;
  }
  const saved=client.data.get(`dailyPuzzles/${future}`);
  assert.equal(saved.revision,3);assert.equal(saved.published,false);assert.deepEqual(validatePuzzle(saved.puzzle),[]);
  for(const game of GAMES)assert.deepEqual(saved.puzzle[GAME_FIELDS[game]],sample[GAME_FIELDS[game]]);
  assert.equal(saved.credits.player.displayName,"Joe123");assert.equal(saved.credits.ladder.displayName,"Sarah45");assert.equal(saved.credits.cross.displayName,"SportsFan22");
  assert.equal(client.writes[1].kind,"update");assert.ok("puzzle.statLadder" in client.writes[1].value);assert.ok(!("puzzle" in client.writes[1].value));
  assert.ok("puzzle.crossSport" in client.writes[2].value);
});

test("replacement requires confirmation and a current revision, and changes only the chosen slot",async()=>{
  const client=fixture();for(const [i,game]of GAMES.entries())await importOwnerGame(client,future,envelope(game),i);
  const before=clone(client.data.get(`dailyPuzzles/${future}`));const changed=envelope("ladder","NewAuthor");changed.data.questions[0].question+=" Give the full name.";
  await assert.rejects(importOwnerGame(client,future,changed,3),{code:"import/overwrite-required"});
  await assert.rejects(importOwnerGame(client,future,changed,2,true),/changed in another tab/);
  assert.deepEqual(client.data.get(`dailyPuzzles/${future}`),before);
  await importOwnerGame(client,future,changed,3,true);const after=client.data.get(`dailyPuzzles/${future}`);
  assert.deepEqual(after.puzzle.playerGuess,before.puzzle.playerGuess);assert.deepEqual(after.puzzle.crossSport,before.puzzle.crossSport);
  assert.deepEqual(after.credits.player,before.credits.player);assert.deepEqual(after.credits.cross,before.credits.cross);assert.equal(after.credits.ladder.displayName,"NewAuthor");
});

test("live answers and clues cannot be replaced, while a credit-only correction preserves content and scores",async()=>{
  const client=fixture();const path=`dailyPuzzles/${sample.date}`;
  client.data.set(path,{date:sample.date,puzzle:clone(sample),published:true,unlockAt:new Stamp(Date.now()-1000),revision:1});
  client.data.set("results/original-score",{score:8});const puzzleBefore=clone(client.data.get(path).puzzle);
  await assert.rejects(importOwnerGame(client,sample.date,envelope("player"),1,true),/already live/);
  await assert.rejects(persistOwnerSlate(client,{...sample},true,1),/already live/);
  await saveOwnerCredits(client,sample.date,{player:{displayName:"Joe123"}},1);
  assert.deepEqual(client.data.get(path).puzzle,puzzleBefore);assert.deepEqual(client.data.get("results/original-score"),{score:8});
  assert.equal(client.data.get(path).credits.player.displayName,"Joe123");
});

test("submissions atomically create a pending original and enforce cooldown and a rolling daily quota",async()=>{
  let clock=Date.now();mock.method(Date,"now",()=>clock);
  try{
    const client=fixture();client.auth.currentUser={uid:"anonymous-guest",isAnonymous:true};
    const id=await submitCommunityPuzzle(client,envelope("player"));
    const saved=client.data.get(`submissions/${id}`);assert.equal(saved.status,"pending");assert.equal(saved.proposedName,"Joe123");assert.equal(saved.submittedBy,"anonymous-guest");assert.deepEqual(JSON.parse(saved.puzzleJson),sample.playerGuess);
    assert.equal(client.data.get("submissionLimits/anonymous-guest").count,1);assert.equal(saved.reviewedName,undefined);
    await assert.rejects(submitCommunityPuzzle(client,envelope("cross")),{code:"submission/rate-limited"});
    for(let i=1;i<5;i++){clock+=60001;await submitCommunityPuzzle(client,envelope(GAMES[i%3]));}
    clock+=60001;await assert.rejects(submitCommunityPuzzle(client,envelope("ladder")),/five suggestions/);
    clock+=86400000;await submitCommunityPuzzle(client,envelope("cross"));assert.equal(client.data.get("submissionLimits/anonymous-guest").count,1);
  }finally{mock.restoreAll();}
});

test("review, approved export, import, and publication retain the original name and carry the edited credit",async()=>{
  const client=fixture();const id=await submitCommunityPuzzle(client,envelope("player","OriginalJoe"));
  let submission={id,...clone(client.data.get(`submissions/${id}`))};assert.throws(()=>submissionEnvelope(submission,true),/Approve/);
  await saveSubmissionReview(client,submission,sample.playerGuess,"ApprovedJoe","approved");
  submission={id,...clone(client.data.get(`submissions/${id}`))};const exported=submissionEnvelope(submission,true);
  assert.equal(exported.creatorCredit,"ApprovedJoe");assert.equal(exported.submissionId,id);assert.equal(submission.proposedName,"OriginalJoe");
  await importOwnerGame(client,future,exported,0);await importOwnerGame(client,future,envelope("ladder","Sarah45"),1);const result=await importOwnerGame(client,future,envelope("cross","CrossAuthor"),2);
  await persistOwnerSlate(client,result.slate,true,3);
  const published=client.data.get(`submissions/${id}`);assert.equal(published.status,"published");assert.deepEqual(published.publishedDates,[future]);
  assert.equal(published.proposedName,"OriginalJoe");assert.equal(client.data.get(`dailyPuzzles/${future}`).credits.player.displayName,"ApprovedJoe");
});

test("editing a published creator credit propagates without changing a live puzzle or another game's credit",async()=>{
  const client=fixture();const id=await submitCommunityPuzzle(client,envelope("player","OriginalJoe"));
  let submission={id,...clone(client.data.get(`submissions/${id}`))};await saveSubmissionReview(client,submission,sample.playerGuess,"ApprovedJoe","approved");
  submission={id,...clone(client.data.get(`submissions/${id}`))};await importOwnerGame(client,future,submissionEnvelope(submission,true),0);
  await importOwnerGame(client,future,envelope("ladder","Sarah45"),1);const result=await importOwnerGame(client,future,envelope("cross","CrossAuthor"),2);await persistOwnerSlate(client,result.slate,true,3);
  const day=client.data.get(`dailyPuzzles/${future}`);day.unlockAt=new Stamp(Date.now()-1000);const original=clone(day.puzzle);
  submission={id,...clone(client.data.get(`submissions/${id}`))};const edited=clone(sample.playerGuess);edited.hints[0]="A corrected fact for a future export.";
  await saveSubmissionReview(client,submission,edited,"CorrectedJoe","published");
  assert.deepEqual(client.data.get(`dailyPuzzles/${future}`).puzzle,original);assert.equal(client.data.get(`dailyPuzzles/${future}`).credits.player.displayName,"CorrectedJoe");
  assert.equal(client.data.get(`dailyPuzzles/${future}`).credits.ladder.displayName,"Sarah45");assert.equal(client.data.get(`submissions/${id}`).proposedName,"OriginalJoe");
  assert.throws(()=>submissionEnvelope({id,...client.data.get(`submissions/${id}`),status:"pending"},true),/Approve/);
});

test("rejecting malformed original JSON doesn't require parsing or publishing it",async()=>{
  const client=fixture();const id="bad-payload";const original={schemaVersion:1,game:"player",puzzleJson:"not json",proposedName:"Joe123",submittedBy:"guest",status:"pending",revision:1};client.data.set(`submissions/${id}`,clone(original));
  await rejectSubmission(client,{id,...original});assert.equal(client.data.get(`submissions/${id}`).status,"rejected");assert.equal(client.data.get(`submissions/${id}`).puzzleJson,"not json");assert.equal([...client.data.keys()].some(key=>key.startsWith("dailyPuzzles/")),false);
});
