// Firebase discovery loads every export. A deployed Off Grids worker only needs
// its small module, rather than the entire generation/voice/document pipeline.
const offGridTargets = new Set([
  'offGridCommand', 'offGridDirectory', 'offGridMedia', 'offGridShare', 'syncOffGridSpots',
]);
module.exports = offGridTargets.has(process.env.FUNCTION_TARGET || '')
  ? require('./off-grids') : require('./index');
export {};
