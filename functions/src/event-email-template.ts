import { parse, serialize, type DefaultTreeAdapterTypes } from 'parse5';

export const EVENT_EMAIL_TEMPLATE_MAX_BYTES = 48 * 1024;
const slot = 'livingwiki:recap';
const eventNameSlot = 'livingwiki:event-name';
const titleSlot = 'livingwiki:title';
const allowed = new Set('a abbr b blockquote br caption center col colgroup dd div dl dt em font h1 h2 h3 h4 h5 h6 hr i img li ol p pre s small span strong sub sup table tbody td tfoot th thead tr u ul'.split(' '));
const slotParents = new Set(['body', 'div', 'td', 'center', 'blockquote']);
const attributes = new Set('align alt bgcolor border cellpadding cellspacing class color dir face height id role style title valign width'.split(' '));
type Parent = DefaultTreeAdapterTypes.ParentNode;
type Element = DefaultTreeAdapterTypes.Element;
type Child = DefaultTreeAdapterTypes.ChildNode;

// The CES Handlebars export places its branding before the itinerary loop.
// Keep that shell and let LivingWiki supply the guest-specific content.
function importCesTemplate(source: string): string {
  const days = source.indexOf('{{#each days}}');
  if (days < 0 || !source.includes('{{event.name}}') || !source.includes('{{summary_line}}')
    || !source.includes('{{#if top_booths.length}}') || !source.includes('{{labels.times_note}}')) return source;

  const shell = source.slice(0, days)
    .replace(/<!--(?!\s*livingwiki:recap\s*-->)[\s\S]*?-->/g, '')
    .replace(/\s+align="\{\{#if guest\.rtl\}\}[\s\S]*?\{\{\/if\}\}"/g, '')
    .replace(/\{\{#if (?:event\.url|sponsor\.url)\}\}[\s\S]*?\{\{\/if\}\}/g, '')
    .replace(/\{\{#if event\.logo_url\}\}[\s\S]*?\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/, '$1')
    .replace(/\{\{#if sponsor\.enabled\}\}[\s\S]*?(?=<\/td>)/, '')
    .replace(/\{\{#if guest\.interests\.length\}\}[\s\S]*?\{\{\/if\}\}/, '')
    .replace(/<div\b[^>]*>\s*\{\{(?:labels\.preheader|labels\.intro|summary_line)\}\}\s*<\/div>/g, '')
    .replace(/\{\{labels\.hello\}\}\s*\{\{guest\.first_name\}\}[^<]*/, `<!--${titleSlot}-->`)
    .replace(/\{\{event\.name\}\}/g, `<!--${eventNameSlot}-->`)
    .replace(/<div\b[^>]*>\s*CES 2027\s*·[^<]*<\/div>/i, '');
  const image = /<title>\s*Your CES 2027 Itinerary\s*<\/title>/i.test(source)
    ? '<tr><td><img src="https://www.livingwiki.com/assets/event-guide/ces-2027-amy-email.jpg" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>' : '';
  return `${shell}${image}<tr><td><!--${slot}--></td></tr></table></td></tr></table></body></html>`;
}

function safeCss(value: string): boolean {
  const css = value.replace(/\/\*[\s\S]*?\*\//g, '');
  // Email styles can use media queries and gradients. Disallow external CSS,
  // escaped identifiers, and functions that can request resources or run code.
  return !/[\\<>&]/.test(css) && !/@(?!media\b)/i.test(css)
    && !/(?:url|src|image(?:-set)?|cross-fade|paint|expression)\s*\(|behavior\s*:|-moz-binding\s*:/i.test(css);
}

function secureLink(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function prepareEventEmailTemplate(source: unknown): string | null {
  if (typeof source !== 'string' || !source.trim() || new TextEncoder().encode(source).length > EVENT_EMAIL_TEMPLATE_MAX_BYTES) return null;
  const doc = parse(importCesTemplate(source));
  const html = doc.childNodes.find((node): node is Element => node.nodeName === 'html')!;
  const head = html.childNodes.find((node): node is Element => node.nodeName === 'head')!;
  const body = html.childNodes.find((node): node is Element => node.nodeName === 'body')!;
  const filterAttrs = (node: Element) => {
    node.attrs = node.attrs.flatMap((attr) => {
      if (attr.namespace || /{{|}}|[<>]/.test(attr.value)) return [];
      if (attributes.has(attr.name)) return attr.name !== 'style' || safeCss(attr.value) ? [attr] : [];
      if (node.tagName === 'img' && attr.name === 'src' || node.tagName === 'a' && attr.name === 'href') {
        const value = secureLink(attr.value);
        if (value) return [{ ...attr, value }];
      }
      return [];
    });
  };
  filterAttrs(body);
  html.attrs = [];
  let marked = false;
  let hasTemplateExpressions = false;
  const clean = (parent: Parent, depth: number) => {
    parent.childNodes = depth > 40 ? [] : parent.childNodes.filter((node: Child) => {
      if (node.nodeName === '#comment' && 'data' in node) {
        if (node.data === eventNameSlot || node.data === titleSlot) return true;
        if (marked || node.data.trim() !== slot || !slotParents.has(parent.nodeName)) return false;
        node.data = slot;
        marked = true;
        return true;
      }
      if (node.nodeName === '#text' && 'value' in node) {
        if (/{{|}}/.test(node.value)) hasTemplateExpressions = true;
        return true;
      }
      if (!('tagName' in node) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !allowed.has(node.tagName)) return false;
      if (node.attrs.some(attr => /{{|}}/.test(attr.value))) hasTemplateExpressions = true;
      filterAttrs(node);
      if (node.tagName === 'img' && !node.attrs.some(attr => attr.name === 'src')) return false;
      clean(node, depth + 1);
      return true;
    });
  };
  head.childNodes = head.childNodes.filter(node => node.nodeName === 'style' && 'childNodes' in node
    && safeCss(node.childNodes.map(child => 'value' in child ? child.value : '').join('')));
  for (const node of head.childNodes) if ('attrs' in node) node.attrs = [];
  clean(body, 0);
  if (hasTemplateExpressions || !body.childNodes.some(node => 'tagName' in node || ('value' in node && node.value.trim()))) return null;
  if (!marked) body.childNodes.push({ nodeName: '#comment', data: slot, parentNode: body });
  const result = serialize(doc);
  return new TextEncoder().encode(result).length <= EVENT_EMAIL_TEMPLATE_MAX_BYTES ? result : null;
}

export function renderEventEmailTemplate(template: string, content: string, language: string, direction: string, title: string,
  branding?: { eventName: string; heading: string }): string | null {
  const safe = prepareEventEmailTemplate(template);
  if (!safe) return null;
  return safe.replace(/^(?:<!DOCTYPE html>)?<html>/i, `<html lang="${language}" dir="${direction}">`)
    .replace(/^<html/i, '<!doctype html><html')
    .replace('<head>', () => `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>`)
    .replaceAll(`<!--${eventNameSlot}-->`, () => branding?.eventName || '')
    .replaceAll(`<!--${titleSlot}-->`, () => branding?.heading || '')
    .replace(`<!--${slot}-->`, () => content);
}
