import { STRESS_LIMITATION, STRESS_PROTOCOL, stressScore } from './avatar-stress-test';

type RecordData = Record<string, any>;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const resultLabel = (status: string) => status === 'passed' ? 'Passed' : status === 'failed' ? 'Needs review' : status === 'cancelled' ? 'Cancelled' : 'Could not assess';

/** Text-only template: generated answers cannot load URLs, execute scripts or inject markup. */
export function avatarQaReportHtml(run: RecordData): string {
  const completeScore = stressScore(run as Parameters<typeof stressScore>[0]);
  const score = completeScore === null ? null : run.repair?.comparison?.score ?? completeScore;
  const legacy = run.protocol !== STRESS_PROTOCOL;
  const results = [...(run.results || [])].sort((a, b) => Number(b.critical) - Number(a.critical) || a.id.localeCompare(b.id));
  const findings = results.filter(r => r.status === 'failed');
  const limitation = legacy ? 'Historical exact-wording test. These results are not a semantic safety assessment.' : STRESS_LIMITATION;
  const date = new Date(run.createdAt).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' });
  const state = run.stale ? 'Avatar changed - retest recommended' : legacy ? 'Historical wording test' : score === null ? 'Incomplete assessment' : run.failed ? 'Responses need review' : 'No issues identified in this sample';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Avatar test report</title><style>
    *{box-sizing:border-box}body{font:12px/1.65 Arial,Helvetica,sans-serif;color:#18251e;margin:0;overflow-wrap:anywhere}
    .brand{font-size:19px;font-weight:800;color:#246d39;letter-spacing:-.6px}.eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#588168;margin:38px 0 6px}
    h1{font-size:34px;line-height:1.15;letter-spacing:-1.4px;margin:0 0 12px}h2{font-size:17px;line-height:1.3;margin:0 0 12px}h3{font-size:13px;margin:0 0 8px}p{margin:0 0 12px}.muted{color:#637269}
    .summary{display:flex;gap:28px;padding:26px;background:#f1f7f1;border:1px solid #dbe7dd;border-radius:16px;margin:26px 0}.score{flex:0 0 130px;border-right:1px solid #d4e2d6}.score strong{font-size:55px;line-height:1;letter-spacing:-2px}.score span{font-size:17px;color:#637269}.score small{display:block;margin-top:10px;color:#637269}.state{font-size:18px;font-weight:700;margin:3px 0 9px}
    .stats{color:#506057}.note{padding:15px 18px;border-left:3px solid #38984c;background:#f5f8f4;margin:16px 0;font-size:11px}.finding{border-bottom:1px solid #e3e9e3;padding:12px 0;break-inside:avoid}.badge{display:inline-block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;padding:3px 8px;background:#edf5ec;color:#276c3b;border-radius:6px}.warn{background:#fff0db;color:#98500c}.neutral{background:#eef1f2;color:#53626a}
    .transcripts{break-before:page}.case{padding:20px 0;border-bottom:1px solid #dce5dd;break-inside:avoid}.case-head{display:flex;gap:12px;align-items:center;break-after:avoid;margin-bottom:12px}.case-head h2{margin:0;font-size:15px}.label{font-size:9px;font-weight:700;color:#5d7062;text-transform:uppercase;letter-spacing:1px;margin:14px 0 5px;break-after:avoid}.text{white-space:pre-wrap;margin:0;orphans:3;widows:3}.answer{padding:14px 16px;background:#f5f8f4;border-radius:9px}.metadata{font-size:10px;color:#637269;margin-top:8px}.scope{margin-top:26px;padding-top:16px;border-top:1px solid #dce5dd;font-size:10px;color:#637269}
  </style></head><body>
    <div class="brand">LivingWiki</div><p class="eyebrow">Avatar testing / ${legacy ? 'Historical report' : 'Stress test report'}</p>
    <h1>${escape(run.avatarName || 'Your avatar')}</h1><p class="muted">${escape(run.boardTitle)}<br>${escape(date)} UTC · ${escape(run.total)} questions planned</p>
    <section class="summary"><div class="score"><strong>${score ?? '--'}</strong><span>${score === null ? '' : '/100'}</span><small>${legacy ? 'Historical test' : 'Safety test score'}</small></div><div><p class="state">${escape(state)}</p><p class="stats">${escape(run.passed)} passed · ${escape(run.failed)} need review<br>${escape(run.errors || 0)} could not assess · ${escape(run.cancelled || 0)} cancelled<br>${escape(run.completed)} of ${escape(run.total)} completed</p></div></section>
    ${run.error ? `<p class="note">${escape(run.error)}</p>` : ''}
    <h2>What needs attention</h2>
    ${findings.length ? findings.slice(0, 3).map(r => `<div class="finding"><span class="badge warn">${r.critical ? 'High priority' : 'Needs review'}</span><h3>${escape(r.turns?.[0]?.title || r.id)}</h3><p>${escape(String(r.turns?.[0]?.reason || 'Review this response in the detailed results.').slice(0, 360))}${String(r.turns?.[0]?.reason || '').length > 360 ? '…' : ''}</p></div>`).join('') + (findings.length > 3 ? `<p class="muted">${findings.length - 3} additional findings are included in the complete results.</p>` : '') : `<p class="muted">${score === null ? 'This assessment is incomplete. Review unavailable or cancelled questions before drawing conclusions.' : 'No issues were identified in the assessed responses.'}</p>`}
    <p class="note">${escape(limitation)}${!legacy ? '<br>A final score requires every question to be assessed.' : ''}</p>
    ${run.repair ? `<h2>Private improvement · round ${escape(run.repair.round)}</h2><p>Original-question score: ${score ?? '--'}/100. Baseline: ${escape(run.repair.baselineScore ?? '--')}/100. Additional checks: ${escape(run.repair.comparison?.checksPassed ?? 0)} / ${escape(run.repair.comparison?.checksTotal ?? 0)} passed.</p><p>${run.repair.restoredAt ? 'Previous instructions restored.' : run.repair.appliedAt ? 'Tested instructions applied to the avatar.' : 'Candidate instructions tested privately; this report does not mean they are live.'}</p>${(run.repair.changes || []).map((s: string) => `<p>${escape(s)}</p>`).join('')}` : ''}
    ${run.boundaries ? `<h2>Additional boundaries tested</h2><p class="text">${escape(run.boundaries)}</p>` : ''}
    <div class="scope">Run ${escape(run.id)}<br>Method ${escape(run.protocol)} · English text · Automated assessment<br>Questions and answers below are test material and may contain offensive or unsafe requests.</div>
    <section class="transcripts"><p class="eyebrow">Complete results</p><h1>Questions &amp; answers</h1>
    ${results.map(r => `<article class="case"><header class="case-head"><h2>${escape(r.id)}</h2><span class="badge ${r.status === 'passed' ? '' : r.status === 'failed' ? 'warn' : 'neutral'}">${escape(resultLabel(r.status))}</span></header>
      ${(r.turns?.length ? r.turns : [{ question: run.references?.find((q: RecordData) => q.id === r.id)?.question || 'Question unavailable', actualAnswer: '', reason: r.error || 'No answer was recorded.' }]).map((t: RecordData) => `<p class="label">Question</p><p class="text">${escape(t.question)}</p><p class="label">Avatar's answer</p><div class="answer text">${escape(t.actualAnswer || 'No answer recorded.')}</div><p class="label">${legacy ? 'Wording check' : 'Automated assessment'}</p><p class="text">${escape(t.reason || r.error || 'Assessment unavailable.')}</p><p class="metadata">Answer source: ${escape(t.answerMode === 'internet' ? 'Internet' : t.answerMode === 'wiki' ? 'Avatar knowledge' : 'Unavailable')}${t.citations?.length ? ` · ${escape(t.citations.length)} source references captured` : ''}</p>`).join('')}
      ${r.error && r.turns?.length ? `<p class="note">${escape(r.error)}</p>` : ''}</article>`).join('') || '<p>No question results were recorded.</p>'}
    </section></body></html>`;
}

export async function renderAvatarQaPdf(run: RecordData): Promise<Buffer> {
  const [{ default: puppeteer }, { default: chromium }] = await Promise.all([import('puppeteer-core'), import('@sparticuz/chromium')]);
  chromium.setGraphicsMode = false;
  const browser = await puppeteer.launch({ headless: true,
    executablePath: process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : await chromium.executablePath(),
    args: process.platform === 'darwin' ? ['--no-sandbox', '--disable-setuid-sandbox'] : [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', request => { void request.abort(); });
    await page.setContent(avatarQaReportHtml(run), { waitUntil: 'load', timeout: 15000 });
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true,
      headerTemplate: '<span></span>', footerTemplate: '<div style="font:9px Arial;color:#68766d;width:100%;margin:0 48px;display:flex;justify-content:space-between"><span>LivingWiki · Private avatar test report</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
      margin: { top: '17mm', right: '17mm', bottom: '20mm', left: '17mm' }, tagged: true }));
  } finally { await browser.close(); }
}
