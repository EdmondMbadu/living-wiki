import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

export async function prepareHostingRuntimeConfig({ publicDirectory, configPath, expectedProjectId }) {
  // This file is intentionally gitignored. A checkout without it must never
  // publish an app whose first request falls through to the SPA HTML rewrite.
  const source = await readFile(configPath, 'utf8');
  const context = { window: {} };
  runInNewContext(source, context, { timeout: 1000 });
  const firebase = context.window.__LIVING_ATLAS_CONFIG__?.firebase;
  for (const key of ['apiKey', 'authDomain', 'projectId', 'appId']) {
    if (typeof firebase?.[key] !== 'string' || !firebase[key].trim()) {
      throw new Error(`Runtime configuration is missing firebase.${key}. Hosting was not prepared.`);
    }
  }
  if (expectedProjectId && firebase.projectId !== expectedProjectId) {
    throw new Error('Runtime configuration does not match the Hosting project.');
  }

  const digest = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const configName = `runtime-config-${digest}.js`;
  const pages = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await collect(path);
      else if (entry.isFile() && entry.name.endsWith('.html')) pages.push(path);
    }
  }
  await collect(publicDirectory);
  const updates = [];
  for (const path of pages) {
    const html = await readFile(path, 'utf8');
    const updated = html.replace(
      /(<script\b[^>]*\bsrc=["'])\/runtime-config(?:-[a-f0-9]{12})?\.js(?:\?[^"']*)?(["'])/g,
      `$1/${configName}$2`,
    );
    if (updated.includes(`/${configName}`)) updates.push({ path, html: updated });
  }
  if (!updates.some(({ path }) => path === join(publicDirectory, 'index.csr.html'))) {
    throw new Error('The Hosting SPA entry point is missing its runtime configuration script.');
  }

  // A new URL bypasses browsers that cached the old missing-file HTML response.
  await writeFile(join(publicDirectory, configName), source);
  await writeFile(join(publicDirectory, 'runtime-config.js'), source);
  for (const { path, html } of updates) await writeFile(path, html);
  return { configName, pages: updates.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hosting = JSON.parse(await readFile('firebase.json', 'utf8')).hosting;
  const project = process.env.GCLOUD_PROJECT
    || JSON.parse(await readFile('.firebaserc', 'utf8')).projects.default;
  const result = await prepareHostingRuntimeConfig({
    publicDirectory: resolve(hosting.public),
    configPath: resolve('public/runtime-config.js'),
    expectedProjectId: project,
  });
  console.log(`Hosting runtime configuration ready: ${result.configName}; ${result.pages} HTML pages.`);
}
