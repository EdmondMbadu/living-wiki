const assert = require('node:assert/strict');
const test = require('node:test');
const JSZip = require('jszip');
const ces = require('../lib/event-guide-ces2027.json');
const { normalizeEventRows, parseEventSource } = require('../lib/event-guide-import');
const { buildEventPlan, eventPreferences, lookupEvent } = require('../lib/event-guide-planner');
const { renderEventEmail } = require('../lib/event-guide-email');
const { eventDates, eventSettings } = require('../lib/event-guide-model');

const settings = {
  datasetId: 'a'.repeat(64), name: 'CES 2027', startDate: '2027-01-05', endDate: '2027-01-09',
  timeZone: 'America/Los_Angeles', informationUrl: 'https://example.org/event',
  privacyUrl: 'https://example.org/privacy', travelMinutes: 30,
};
const headers = ['Date', 'Title', 'Start', 'End', 'Location'];
const cells = ['2027-01-05', 'Robotics demo', '10:00', '10:40', 'Hall A'];
const row = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));

function pdfTable(blank = false) {
  const columnPositions = [34, 136, 300, 365, 441];
  const pages = [cells, ['2027-01-06', 'AI workshop', '11:00', '11:40', 'Hall B']];
  const streams = pages.map((record) => (blank ? [] : [headers, record]).flatMap((values, rowIndex) => values.map((value, col) =>
    `BT /F1 10 Tf 1 0 0 1 ${columnPositions[col]} ${700 - 25 * rowIndex} Tm (${value}) Tj ET`,
  )).join('\n'));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${streams[0].length} >>\nstream\n${streams[0]}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    `<< /Length ${streams[1].length} >>\nstream\n${streams[1]}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return Buffer.from(pdf + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

async function officeFile(type) {
  const zip = new JSZip();
  if (type === 'docx') {
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>${
      [headers, cells].map((line) => `<w:tr>${line.map((value) => `<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')
    }</w:tbl></w:body></w:document>`);
  } else {
    zip.file('xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Readme" r:id="rId1"/><sheet name="Agenda" r:id="rId2"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData/></worksheet>');
    zip.file('xl/worksheets/sheet2.xml', `<worksheet><sheetData>${[headers, cells].map((line, rowIndex) =>
      `<row>${line.map((value, col) => `<c r="${'ABCDE'[col]}${rowIndex + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`,
    ).join('')}</sheetData></worksheet>`);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('PDF, Markdown, DOCX, TXT, CSV, XLSX and JSON produce equivalent records', async () => {
  const markdown = ['| Date | Title | Start | End | Location |', '|---|---|---|---|---|', `| ${cells.join(' | ')} |`].join('\n');
  const sources = {
    pdf: pdfTable(),
    md: Buffer.from(markdown),
    docx: await officeFile('docx'),
    txt: Buffer.from([headers, cells].map((line) => line.join('\t')).join('\n')),
    csv: Buffer.from('\uFEFF' + [headers, cells].map((line) => line.map((value) => `"${value}"`).join(',')).join('\r\n')),
    xlsx: await officeFile('xlsx'),
    json: Buffer.from(JSON.stringify({ sessions: [row] })),
  };
  const expected = normalizeEventRows([row], 'schedule', '2027').sessions[0];
  for (const [extension, buffer] of Object.entries(sources)) {
    const result = await parseEventSource({ filename: `program.${extension}`, buffer, kind: 'schedule', year: '2027', sheet: extension === 'xlsx' ? 'Agenda' : '' });
    assert.deepEqual(result.sessions[0], expected, extension);
    assert.equal(result.sessions.length, extension === 'pdf' ? 2 : 1, extension);
    const testSettings = { ...settings, startDate: cells[0], endDate: cells[0] };
    const preferences = eventPreferences({ days: [cells[0]], mustSee: 'Robotics demo' }, testSettings);
    const lookup = lookupEvent(testSettings, result, 'Where is the Robotics demo?', 'en');
    assert.equal(lookup.sessions[0].room, 'Hall A', extension);
    const itinerary = buildEventPlan(testSettings, result, preferences, 'en');
    assert.equal(itinerary.days[0].items.find((item) => item.title === expected.title).start, expected.start, extension);
  }
  const xlsx = await parseEventSource({ filename: 'program.xlsx', buffer: sources.xlsx, kind: 'schedule', year: '2027' });
  assert.deepEqual(xlsx.sheets, ['Readme', 'Agenda']);
  assert.equal(xlsx.sessions.length, 0);
});

test('column mapping, quoted CSV, malformed dates and scanned-PDF fallback', async () => {
  const csv = Buffer.from('Topic,Day,Starts,Ends,Hall\n"AI, robots",2027-02-30,09:00,10:00,North\n"AI ""lab""",2027-01-05,09:00,10:00,North');
  const mapped = await parseEventSource({ filename: 'agenda.csv', buffer: csv, kind: 'schedule', year: '2027',
    mapping: { title: 'Topic', date: 'Day', start: 'Starts', end: 'Ends' } });
  assert.equal(mapped.sessions.length, 1);
  assert.equal(mapped.sessions[0].title, 'AI "lab"');
  assert.match(mapped.warnings.join(' '), /1 rows/);
  const scan = await parseEventSource({ filename: 'scan.pdf', buffer: pdfTable(true), kind: 'schedule',
    year: '2027', extract: async ({ pdf }) => {
      assert.ok(Buffer.isBuffer(pdf));
      return { rows: [row], warnings: ['Page 2 is illegible.'] };
    } });
  assert.equal(scan.sessions.length, 1);
  assert.ok(scan.warnings.includes('Page 2 is illegible.'));
  await assert.rejects(parseEventSource({ filename: 'invalid.exe', buffer: Buffer.from('x'), kind: 'schedule', year: '2027' }), /Choose a PDF/);
});

test('CES answers distinguish open hours, confirmed booths, announced locations, and absent exhibitors', () => {
  assert.equal(ces.sessions.length, 200);
  assert.equal(ces.exhibitors.length, 35);
  assert.equal(ces.sessions.filter((session) => session.kind === 'Keynote').length, 3);
  const ask = (question) => lookupEvent(settings, ces, question, 'en', new Date('2027-01-07T17:00:00Z'));
  assert.match(ask('Where is the Waymo booth?').exhibitors[0].location, /3741/);
  assert.equal(ask('Where is Samsung?').exhibitors[0].status, 'pending');
  assert.equal(ask('Where is Sony?').exhibitors[0].status, 'absent');
  assert.equal(ask('What time does the exhibit floor open on Tuesday?').floorClosed, true);
  assert.equal(ask('What time does the show floor close on Saturday?').floorHours[0].end, 960);
  for (const question of ['What’s on today?', 'What is on January 7?']) {
    const sessions = ask(question).sessions;
    assert.ok(sessions.length && sessions.every((session) => session.date === '2027-01-07'));
  }
  assert.equal(ask('Where is Eureka Park?').exhibitors[0].location, 'Venetian Expo, Hall G');
  assert.equal(ask('Where is the Moon Cheese exhibit?').exhibitors.length, 0);
});

test('Priya’s plan leaves Saturday free, reserves lunch and exhibit blocks, and avoids cross-hall conflicts', () => {
  const days = eventDates(settings.startDate, settings.endDate).slice(0, 4);
  const preferences = eventPreferences({ days, interests: 'Mobility AI agents Robotics', mustSee: 'Waymo', pace: 'curated' }, settings);
  const plan = buildEventPlan(settings, ces, preferences, 'en');
  assert.equal(plan.days.length, 5);
  assert.deepEqual(plan.days.at(-1), { date: '2027-01-09', attending: false, items: [], alternatives: [] });
  assert.ok(plan.days[0].items.some((item) => /Waymo/.test(item.title)));
  assert.ok(plan.days[0].items.every((item) => !['Booth', 'Area'].includes(item.kind)));
  assert.ok(plan.days[1].items.some((item) => item.kind === 'Booth' && item.title === 'Waymo'));
  for (const day of plan.days.filter((item) => item.attending)) {
    assert.equal(day.items.filter((item) => item.kind === 'Break').length, 1);
    assert.ok(day.items.filter((item) => ['Keynote', 'Session', 'Workshop'].includes(item.kind)).length <= 3);
    const floor = ces.floorHours.find((item) => item.date === day.date && item.start < item.end);
    if (floor) {
      const visit = day.items.find((item) => ['Booth', 'Area'].includes(item.kind));
      assert.ok(visit && visit.start >= floor.start && visit.end <= floor.end && visit.end - visit.start >= 90);
    }
    for (const [index, item] of day.items.entries()) {
      if (!index) continue;
      const previous = day.items[index - 1];
      assert.ok(previous.end <= item.start);
      const findVenue = ({ title }) => ces.sessions.find((session) => session.date === day.date && session.title === title)?.venue
        || ces.exhibitors.find((exhibitor) => exhibitor.name === title)?.venue;
      if (findVenue(previous) && findVenue(item) && findVenue(previous) !== findVenue(item)) assert.ok(item.start - previous.end >= 30);
    }
    assert.ok(day.items.every((item) => !item.title.includes('Lenovo')));
  }
});

test('email escapes source strings, uses Arabic direction, local labels, official names, and trusted links', () => {
  const data = { ...ces, sessions: [{ ...ces.sessions[0], title: '<script>Waymo</script>', url: 'javascript:alert(1)' }] };
  const plan = buildEventPlan(settings, data, eventPreferences({ days: ['2027-01-05'] }, settings), 'ar');
  const rendered = renderEventEmail(settings, plan, 'ar', { name: '<Sponsor>', message: 'Approved acknowledgement' });
  assert.match(rendered.html, /lang="ar" dir="rtl"/);
  assert.match(rendered.html, /&lt;script&gt;Waymo&lt;\/script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>|href="javascript:/);
  assert.match(rendered.html, /&lt;Sponsor&gt;/);
  assert.match(rendered.text, /https:\/\/example\.org\/privacy/);
  assert.equal(eventSettings({ ...settings, startDate: '2027-02-30' }), null);
  assert.equal(eventSettings({ ...settings, timeZone: 'bad zone' }), null);
});
