if (process.env.LIVINGWIKI_BATCHED_FUNCTIONS_DEPLOY !== '1') {
  console.error('Use npm run deploy:all for a full release, or npm run deploy:functions -- <function names> to update specific functions. The batched deploy avoids Firebase and Cloud Run quota errors.');
  process.exitCode = 1;
}
