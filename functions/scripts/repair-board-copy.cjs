#!/usr/bin/env node
// Explicit IDs only. Default action is a read-only scan with a recoverable snapshot.
const fs = require('node:fs');
const { db } = require('../lib/firebase');
const { proposeBoardCopyRepair, reviewedBoardCopyPatch } = require('../lib/board-copy-repair');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name)+1] : '';
async function main() {
  const proposalPath = option('--apply');
  if (proposalPath) {
    const proposal = JSON.parse(fs.readFileSync(proposalPath,'utf8'));
    const uid = option('--as-user');
    if (!uid || proposal.collection !== 'team_boards') throw new Error('Apply requires a team-board proposal and --as-user <active-team-member-uid>. Personal boards are scan-only.');
    if (!/^[\w-]{8,160}$/.test(proposal.boardId)) throw new Error('Invalid board ID.');
    const current = (await db.collection('team_boards').doc(proposal.boardId).get()).data();
    if (!current) throw new Error('Board no longer exists.');
    const operation = `copy-repair:${proposal.fingerprint}`;
    if (current.copyRepairOperation === operation) { console.log('Already applied; no changes.'); return; }
    const patch = reviewedBoardCopyPatch(proposal,current);
    const { saveReviewedTeamBoardCopy } = require('../lib/teams');
    const saved = await saveReviewedTeamBoardCopy(uid,{...current,id:proposal.boardId}, {...patch,copyRepairOperation:operation});
    console.log(JSON.stringify({boardId:proposal.boardId,revision:saved.board.team_revision,changed:proposal.changes.length,published:false}));
    return;
  }
  const boardId = option('--team-board') || option('--board');
  const collection = option('--team-board') ? 'team_boards' : 'boards';
  const output = option('--out');
  if (!/^[\w-]{8,160}$/.test(boardId) || !output) throw new Error('Usage: repair-board-copy.cjs --team-board <id> --out <proposal.json> [--replacements <reviewed-copy.json>]; or --apply <proposal.json> --as-user <uid>');
  const snapshot = await db.collection(collection).doc(boardId).get();
  if (!snapshot.exists) throw new Error('Board not found.');
  const replacements = option('--replacements') ? JSON.parse(fs.readFileSync(option('--replacements'),'utf8')) : [];
  const proposal = proposeBoardCopyRepair(boardId,collection,snapshot.data(),replacements);
  // The file contains a private backup. Never overwrite an existing proposal accidentally.
  fs.writeFileSync(output,JSON.stringify(proposal,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({boardId,collection,revision:proposal.revision,issues:proposal.issues,proposedChanges:proposal.changes.length,output}));
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
