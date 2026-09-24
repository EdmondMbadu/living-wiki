import { parseTemplate, TmplAstBoundText, TmplAstElement } from '@angular/compiler';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../src/app/', import.meta.url));
const dryRun = process.argv.includes('--dry-run');
const boundTextAttributes = new Set(['aria-label', 'title', 'alt', 'placeholder']);

async function htmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(path) : entry.isFile() && path.endsWith('.html') ? [path] : [];
  }))).flat();
}

function visibleLiteral(value) {
  if (process.argv.includes('--lowercase')) return /^[a-z]+$/.test(value);
  return /[\p{L}]{2}/u.test(value) && !/^[a-z][a-z0-9_]*$/.test(value);
}

function collectExpressionLiterals(ast, output, visible = true) {
  if (!ast) return;
  const type = ast.constructor.name;
  if (type === 'Interpolation') {
    for (const expression of ast.expressions) collectExpressionLiterals(expression, output, visible);
  } else if (type === 'Conditional') {
    collectExpressionLiterals(ast.trueExp, output, visible);
    collectExpressionLiterals(ast.falseExp, output, visible);
  } else if (type === 'Binary' && ['+', '??', '||'].includes(ast.operation)) {
    collectExpressionLiterals(ast.left, output, visible);
    collectExpressionLiterals(ast.right, output, visible);
  } else if (type === 'LiteralPrimitive' && visible && typeof ast.value === 'string' && visibleLiteral(ast.value)) {
    output.push({ value: ast.value, start: ast.sourceSpan.start, end: ast.sourceSpan.end });
  }
}

function collectTemplateLiterals(nodes, output, inIcon = false) {
  for (const node of nodes) {
    if (node instanceof TmplAstElement) {
      const classes = node.attributes.find((attribute) => attribute.name === 'class')?.value ?? '';
      const skipText = inIcon || /material-symbols/.test(classes) || ['code', 'pre', 'script', 'style'].includes(node.name);
      for (const input of node.inputs) {
        if (boundTextAttributes.has(input.name)) collectExpressionLiterals(input.value.ast, output);
      }
      collectTemplateLiterals(node.children, output, skipText);
      continue;
    }
    if (node instanceof TmplAstBoundText && !inIcon) {
      collectExpressionLiterals(node.value.ast, output);
    }
    if (Array.isArray(node.children)) collectTemplateLiterals(node.children, output, inIcon);
    if (Array.isArray(node.branches)) {
      for (const branch of node.branches) collectTemplateLiterals(branch.children ?? [], output, inIcon);
    }
    if (Array.isArray(node.cases)) {
      for (const switchCase of node.cases) collectTemplateLiterals(switchCase.children ?? [], output, inIcon);
    }
    if (node.empty?.children) collectTemplateLiterals(node.empty.children, output, inIcon);
  }
}

for (const htmlPath of await htmlFiles(appRoot)) {
  if (htmlPath.endsWith('/kiwi/kiwi.html')) continue;
  const html = await readFile(htmlPath, 'utf8');
  const parsed = parseTemplate(html, htmlPath, { preserveWhitespaces: true });
  if (parsed.errors?.length) throw new Error(`${htmlPath}: ${parsed.errors.join('\n')}`);
  const literals = [];
  collectTemplateLiterals(parsed.nodes, literals);
  if (!literals.length) continue;
  const defaultTsPath = htmlPath.replace(/\.html$/, '.ts');
  const siblingFiles = (await readdir(htmlPath.slice(0, htmlPath.lastIndexOf('/')))).filter((name) => name.endsWith('.ts'));
  let tsPath = defaultTsPath;
  let ts = await readFile(tsPath, 'utf8');
  if (!ts.includes(`templateUrl: './${htmlPath.split('/').at(-1)}'`)) {
    for (const file of siblingFiles) {
      const candidate = join(htmlPath.slice(0, htmlPath.lastIndexOf('/')), file);
      const source = await readFile(candidate, 'utf8');
      if (source.includes(`templateUrl: './${htmlPath.split('/').at(-1)}'`)) {
        tsPath = candidate;
        ts = source;
        break;
      }
    }
  }
  const classMatch = /export class \w+[\s\S]{0,250}?\{/.exec(ts);
  if (!classMatch) throw new Error(`Could not find component class in ${tsPath}`);
  const unique = [...new Set(literals.map((literal) => literal.value))];
  if (dryRun) {
    console.log(`${htmlPath}: ${literals.length} literals, ${unique.length} unique`);
    if (process.argv.includes('--examples') && htmlPath.endsWith('/boards/boards.html')) {
      console.log(unique.slice(0, 110).join(' | '));
    }
    continue;
  }
  const existingProperty = /  readonly templateText = \{([\s\S]*?)\n  \};/.exec(ts);
  const previousKeys = existingProperty ? [...existingProperty[1].matchAll(/message(\d+):/g)] : [];
  const nextKey = Math.max(0, ...previousKeys.map((match) => Number(match[1]))) + 1;
  const keyByValue = new Map(unique.map((value, index) => [value, `message${nextKey + index}`]));
  let updatedHtml = html;
  for (const literal of literals.sort((a, b) => b.start - a.start)) {
    const original = html.slice(literal.start, literal.end);
    if (!/^['"]/.test(original)) throw new Error(`${htmlPath}: Unexpected literal ${original}`);
    updatedHtml = `${updatedHtml.slice(0, literal.start)}templateText.${keyByValue.get(literal.value)}${updatedHtml.slice(literal.end)}`;
  }
  const entries = unique.map((value, index) => {
    if (value.includes('`') || value.includes('${')) throw new Error(`${htmlPath}: Cannot localize ${value}`);
    return `    message${nextKey + index}: $localize\`${value}\`,`;
  }).join('\n');
  let updatedTs;
  if (existingProperty) {
    const insertAt = existingProperty.index + existingProperty[0].lastIndexOf('\n  };');
    updatedTs = `${ts.slice(0, insertAt)}\n${entries}${ts.slice(insertAt)}`;
  } else {
    const insertAt = classMatch.index + classMatch[0].length;
    updatedTs = `${ts.slice(0, insertAt)}\n  readonly templateText = {\n${entries}\n  };${ts.slice(insertAt)}`;
  }
  await writeFile(htmlPath, updatedHtml);
  await writeFile(tsPath, updatedTs);
  console.log(`${htmlPath}: marked ${literals.length} dynamic literals`);
}
