// Optional integration suite. Uses a demo project and a running Firestore emulator only.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { persistOwnerSlate, importOwnerGame, saveOwnerCredits } from "../js/community.js";
import { startRankedDrill, acceptRankedAnswer, publishDrillScore, drillLeaderboard } from "../js/leaderboard.js";
import { writeDailyResult, playerResultsForDate } from "../js/firebase.js";
import { gameEnvelope } from "../js/puzzles.js";
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Start the demo Firestore emulator first. See docs/UPGRADES.md.");
const require = createRequire(process.env.DSG_QA_ROOT ? resolve(process.env.DSG_QA_ROOT, "package.json") : import.meta.url);
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const store = require("firebase/firestore");
const { doc, setDoc, getDoc, getDocs, updateDoc, collection, query, limit, Timestamp, serverTimestamp } = store;
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
const sample=JSON.parse(readFileSync(new URL("../data/practice.json",import.meta.url)));
const day="2026-10-22", future="2032-10-25";
const base = () => { const p=structuredClone(sample); delete p.gridIron; delete p.twoMinuteDrill; return p; };
let env;
const context = (uid, provider="password") => env.authenticatedContext(uid,{firebase:{sign_in_provider:provider}});
const client = (uid,provider="password") => ({db:context(uid,provider).firestore(),store,auth:{currentUser:{uid,isAnonymous:provider==="anonymous"}}});
before(async()=>{
  env=await initializeTestEnvironment({projectId:"demo-dailysportsgames-upgrades",firestore:{host,port:Number(port),rules:readFileSync(new URL("../firestore.rules",import.meta.url),"utf8")}});
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await setDoc(doc(db,"owners/owner"),{enabled:true});
    await setDoc(doc(db,`dailyPuzzles/${day}`),{date:day,puzzle:{...sample,date:day},published:true,unlockAt:Timestamp.fromMillis(0),revision:1,credits:{}});
    await setDoc(doc(db,`drillKeys/${day}`),{answers:["arizonacardinals","atlantafalcons","baltimoreravens","philadelphiaeagles","seattleseahawks"],published:true,unlockAt:Timestamp.fromMillis(0)});
    await setDoc(doc(db,`leaguePuzzles/nfl/days/${day}`),{date:day,puzzle:{...base(),date:day,league:"nfl"},published:true,unlockAt:Timestamp.fromMillis(0),revision:1,credits:{}});
    await setDoc(doc(db,`dailyPuzzles/2032-10-26`),{date:"2032-10-26",puzzle:{...sample,date:"2032-10-26"},published:true,unlockAt:Timestamp.fromMillis(Date.now()+86400000),revision:1,credits:{}});
  });
});
after(async()=>{await env?.cleanup();});

test("owner publishes five-game General and three-game NFL to independent documents and one directory",async()=>{
  const owner=client("owner");
  await persistOwnerSlate(owner,{...sample,date:future},true,0);
  await persistOwnerSlate(owner,{...base(),date:future,league:"nfl"},true,0);
  const directory=await getDoc(doc(owner.db,`dailyEditions/${future}`));
  assert.equal(directory.data().published.general,true);assert.equal(directory.data().published.nfl,true);
  const nfl=await getDoc(doc(owner.db,`leaguePuzzles/nfl/days/${future}`));
  assert.equal(nfl.data().puzzle.league,"nfl");assert.equal(nfl.data().puzzle.gridIron,undefined);
  const key=await getDoc(doc(owner.db,`drillKeys/${future}`));assert.equal(key.data().answers.length,5);
  await assertFails(getDoc(doc(client("guest","anonymous").db,`dailyPuzzles/${future}`)));
  await assertFails(getDoc(doc(client("guest","anonymous").db,`leaguePuzzles/nfl/days/${future}`)));
});

test("first league publication preserves a legacy General edition and field imports stay in their league",async()=>{
  const date="2032-11-01",owner=client("owner");
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),`dailyPuzzles/${date}`),{date,puzzle:{...base(),date},published:true,unlockAt:Timestamp.fromMillis(1980000000000),revision:1,credits:{}}));
  await persistOwnerSlate(owner,{...base(),date,league:"mlb"},true,0);
  const directory=await getDoc(doc(owner.db,`dailyEditions/${date}`));assert.deepEqual(directory.data().published,{general:true,mlb:true});
  const newPlayer={...base().playerGuess,answer:"Replacement player"};
  await importOwnerGame(owner,date,gameEnvelope("player",newPlayer,"LeagueAuthor"),1,true,"mlb");
  const general=await getDoc(doc(owner.db,`dailyPuzzles/${date}`));assert.equal(general.data().puzzle.playerGuess.answer,sample.playerGuess.answer);
  const mlb=await getDoc(doc(owner.db,`leaguePuzzles/mlb/days/${date}`));assert.equal(mlb.data().puzzle.playerGuess.answer,"Replacement player");
});

test("guests read only released editions and cannot read private Drill keys or create ranked runs",async()=>{
  const guest=client("guest","anonymous");
  await assertSucceeds(getDoc(doc(guest.db,`dailyPuzzles/${day}`)));
  await assertSucceeds(getDoc(doc(guest.db,`leaguePuzzles/nfl/days/${day}`)));
  await assertFails(getDoc(doc(guest.db,`drillKeys/${day}`)));
  await assertFails(getDoc(doc(guest.db,"dailyPuzzles/2032-10-26")));
  await assert.rejects(startRankedDrill(guest,day,"GuestName"),/Sign in/);
  await assertFails(setDoc(doc(guest.db,`drillRuns/${day}/players/guest`),{playerId:"guest",date:day,displayName:"GuestName",startedAt:serverTimestamp(),found:[]}));
});

test("registered players start one server-clock run and accept only unique canonical answers",async()=>{
  const player=client("ranked-one");
  const run=await startRankedDrill(player,day,"FirstFan"); assert.ok(run.startedAt>0);assert.equal(run.deadline-run.startedAt,120000);
  assert.deepEqual(await acceptRankedAnswer(player,day,"philadelphiaeagles","ranked-one"),["philadelphiaeagles"]);
  const ref=doc(player.db,`drillRuns/${day}/players/ranked-one`);
  await assertFails(updateDoc(ref,{found:["philadelphiaeagles","notarealanswer"]}));
  await assertFails(updateDoc(ref,{found:["philadelphiaeagles","philadelphiaeagles"]}));
  await assertFails(updateDoc(ref,{found:["philadelphiaeagles","arizonacardinals","baltimoreravens"]}));
  await assertFails(updateDoc(ref,{startedAt:serverTimestamp(),found:[]}));
  const resumed=await startRankedDrill(player,day,"ChangedFan");assert.equal(resumed.startedAt,run.startedAt);assert.equal(resumed.displayName,"FirstFan");
  await assertFails(setDoc(ref,{playerId:"ranked-one",date:day,displayName:"FirstFan",startedAt:serverTimestamp(),found:[]}));
  await assertFails(setDoc(doc(player.db,`drillLeaderboards/${day}/scores/ranked-one`),{displayName:"FirstFan",score:1,completedAt:serverTimestamp()}));
});

test("a full-bank finish posts an immutable verified public score containing only a nickname and total",async()=>{
  const player=client("ranked-perfect");await startRankedDrill(player,day,"PerfectFan");
  for(const key of ["arizonacardinals","atlantafalcons","baltimoreravens","philadelphiaeagles","seattleseahawks"]) await acceptRankedAnswer(player,day,key,"ranked-perfect");
  const verified=await publishDrillScore(player,day,"ranked-perfect");assert.equal(verified.score,5);assert.equal(verified.found.length,5); await publishDrillScore(player,day,"ranked-perfect");
  const score=await getDoc(doc(player.db,`drillLeaderboards/${day}/scores/ranked-perfect`));
  assert.deepEqual(Object.keys(score.data()).sort(),["completedAt","displayName","score"]);assert.equal(score.data().score,5);
  await assertFails(updateDoc(doc(player.db,`drillLeaderboards/${day}/scores/ranked-perfect`),{score:500}));
  const rows=await drillLeaderboard(client("reader","anonymous"),day);assert.equal(rows[0].displayName,"PerfectFan");assert.equal(rows[0].rank,1);
});

test("late answers, forged totals, changed nicknames, and another user's run are rejected",async()=>{
  const uid="expired",player=client(uid);
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),`drillRuns/${day}/players/${uid}`),{playerId:uid,date:day,displayName:"TimeFan",startedAt:Timestamp.fromMillis(Date.now()-125000),found:["atlantafalcons"]}));
  await assertFails(updateDoc(doc(player.db,`drillRuns/${day}/players/${uid}`),{found:["atlantafalcons","arizonacardinals"]}));
  const ref=doc(player.db,`drillLeaderboards/${day}/scores/${uid}`);
  await assertFails(setDoc(ref,{displayName:"TimeFan",score:500,completedAt:serverTimestamp()}));
  await assertFails(setDoc(ref,{displayName:"FakeName",score:1,completedAt:serverTimestamp()}));
  await publishDrillScore(player,day,uid);assert.equal((await getDoc(ref)).data().score,1);
  await assertFails(getDoc(doc(client("other").db,`drillRuns/${day}/players/${uid}`)));
  await assertFails(getDocs(query(collection(client("other").db,`drillLeaderboards/${day}/scores`),limit(26))));
});

test("daily General, NFL, grid, and Drill metadata record separately while private history stays private",async()=>{
  const player=client("result-player","anonymous");
  const result={date:day,game:"ladder",score:8,won:true,checks:0,reveals:0,mode:"daily",done:true};
  await writeDailyResult(player,result);await writeDailyResult(player,{...result,league:"nfl",score:4});
  await writeDailyResult(player,{...result,game:"grid",score:9,checks:2});
  await writeDailyResult(player,{...result,game:"drill",score:3});
  const general=await playerResultsForDate(player,day);assert.equal(general.length,3);assert.equal(general.find(r=>r.game==="ladder").score,8);
  const nfl=await playerResultsForDate(player,day,"nfl");assert.equal(nfl.length,1);assert.equal(nfl[0].score,4);
  await assertFails(getDoc(doc(client("other").db,`results/result-player_${day}_ladder`)));
  await assert.rejects(writeDailyResult(player,{...result,game:"drill",league:"nfl"}),/Invalid daily/);
});

test("live league content stays locked while owner-only creator corrections remain allowed",async()=>{
  const owner=client("owner");
  await assert.rejects(persistOwnerSlate(owner,{...base(),date:day,league:"nfl"},true,1),/already live/);
  await saveOwnerCredits(owner,day,{player:{displayName:"NFLAuthor"}},1,"nfl");
  const nfl=await getDoc(doc(owner.db,`leaguePuzzles/nfl/days/${day}`));assert.equal(nfl.data().credits.player.displayName,"NFLAuthor");
  const general=await getDoc(doc(owner.db,`dailyPuzzles/${day}`));assert.equal(general.data().credits.player,undefined);
});

test("community credit corrections propagate across General and NFL on the same date without replacing either puzzle",async()=>{
  const { submitCommunityPuzzle, saveSubmissionReview, submissionEnvelope }=await import("../js/community.js");
  const owner=client("owner"), date="2032-12-01";
  const id=await submitCommunityPuzzle(owner,gameEnvelope("player",sample.playerGuess,"OriginalFan"));
  let suggestion={id,...(await getDoc(doc(owner.db,`submissions/${id}`))).data()};
  await saveSubmissionReview(owner,suggestion,sample.playerGuess,"ApprovedFan","approved");
  suggestion={id,...(await getDoc(doc(owner.db,`submissions/${id}`))).data()};
  const envelope=submissionEnvelope(suggestion,true);
  const general=await importOwnerGame(owner,date,envelope,0);
  await persistOwnerSlate(owner,{...base(),date,credits:general.slate.credits},true,1);
  const nfl=await importOwnerGame(owner,date,envelope,0,false,"nfl");
  await persistOwnerSlate(owner,{...base(),date,league:"nfl",credits:nfl.slate.credits},true,1);
  const beforeGeneral=(await getDoc(doc(owner.db,`dailyPuzzles/${date}`))).data().puzzle;
  const beforeNFL=(await getDoc(doc(owner.db,`leaguePuzzles/nfl/days/${date}`))).data().puzzle;
  await saveOwnerCredits(owner,date,{player:{displayName:"CorrectedFan",submissionId:id}},2,"nfl");
  const afterGeneral=(await getDoc(doc(owner.db,`dailyPuzzles/${date}`))).data();
  const afterNFL=(await getDoc(doc(owner.db,`leaguePuzzles/nfl/days/${date}`))).data();
  assert.equal(afterGeneral.credits.player.displayName,"CorrectedFan");assert.equal(afterNFL.credits.player.displayName,"CorrectedFan");
  assert.deepEqual(afterGeneral.puzzle,beforeGeneral);assert.deepEqual(afterNFL.puzzle,beforeNFL);
  const source=(await getDoc(doc(owner.db,`submissions/${id}`))).data();
  assert.equal(source.proposedName,"OriginalFan");assert.deepEqual(source.publishedAssignments,[`general:${date}`,`nfl:${date}`]);
  await assertFails(getDoc(doc(client("guest","anonymous").db,`submissions/${id}`)));
});

test("a Drill can be the first private import, and omitting it later disables its ranked backend",async()=>{
  const owner=client("owner"),date="2032-12-05";
  await importOwnerGame(owner,date,gameEnvelope("drill",sample.twoMinuteDrill),0);
  let saved=await getDoc(doc(owner.db,`dailyPuzzles/${date}`));assert.equal(saved.data().published,false);assert.ok(saved.data().puzzle.twoMinuteDrill);
  await persistOwnerSlate(owner,{...sample,date},true,1);
  let key=await getDoc(doc(owner.db,`drillKeys/${date}`));assert.equal(key.data().published,true);
  await persistOwnerSlate(owner,{...base(),date},true,2);
  key=await getDoc(doc(owner.db,`drillKeys/${date}`));assert.equal(key.data().published,false);
  saved=await getDoc(doc(owner.db,`dailyPuzzles/${date}`));assert.equal(saved.data().puzzle.twoMinuteDrill,undefined);
});
