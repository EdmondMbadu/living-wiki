import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';

function javaMajor(javaExecutable, environment) {
  const result = spawnSync(javaExecutable, ['-version'], {
    encoding: 'utf8',
    env: environment,
  });
  const versionOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const match = versionOutput.match(/version\s+"(?:1\.)?(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : 0;
}

let environment = { ...process.env };
let javaExecutable = 'java';

if (javaMajor(javaExecutable, environment) < 21 && process.platform === 'darwin') {
  const javaHomeResult = spawnSync('/usr/libexec/java_home', [], { encoding: 'utf8' });
  const javaHome = javaHomeResult.status === 0 ? javaHomeResult.stdout.trim() : '';
  const candidate = javaHome ? join(javaHome, 'bin', 'java') : '';
  if (candidate && javaMajor(candidate, environment) >= 21) {
    environment = {
      ...environment,
      JAVA_HOME: javaHome,
      PATH: `${join(javaHome, 'bin')}${delimiter}${environment.PATH ?? ''}`,
    };
    javaExecutable = candidate;
  }
}

if (javaMajor(javaExecutable, environment) < 21) {
  console.error('Firestore rule tests require Java 21 or newer.');
  process.exit(1);
}

const build = spawnSync('npm', ['--prefix', 'functions', 'run', 'build'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

// Local development servers often occupy Firebase's default port 8080. Give
// each test run its own emulator ports so this regression suite is runnable.
const reservations = await Promise.all(Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server));
})));
const [firestorePort, websocketPort, hubPort, loggingPort] = reservations.map((server) => server.address().port);
await Promise.all(reservations.map((server) => new Promise((resolve) => server.close(resolve))));
const configDirectory = mkdtempSync(join(tmpdir(), 'livingwiki-firestore-tests-'));
const configPath = join(configDirectory, 'firebase.json');
writeFileSync(configPath, JSON.stringify({
  firestore: {
    rules: join(process.cwd(), 'firestore.rules'),
    indexes: join(process.cwd(), 'firestore.indexes.json'),
  },
  emulators: {
    firestore: { host: '127.0.0.1', port: firestorePort, websocketPort },
    hub: { host: '127.0.0.1', port: hubPort },
    logging: { host: '127.0.0.1', port: loggingPort },
    ui: { enabled: false },
  },
}));

const result = spawnSync(
  'firebase',
  [
    'emulators:exec',
    '--config',
    configPath,
    '--project',
    'demo-living-wiki',
    '--only',
    'firestore',
    'node --test --test-concurrency=1 tests/firestore/atlas-privacy.rules.test.mjs tests/firestore/board-save.rules.test.mjs tests/firestore/teams.rules.test.mjs tests/firestore/teams.integration.test.mjs functions/scripts/test-off-grids.integration.cjs',
  ],
  {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
  },
);

rmSync(configDirectory, { recursive: true, force: true });
process.exit(result.status ?? 1);
