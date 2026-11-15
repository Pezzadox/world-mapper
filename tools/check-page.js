// A small guard: the reading page must parse and still have the parts that matter.
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(__dirname + '/../www/index.html', 'utf8');
let bad = [];

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scripts.length) bad.push('no script found in the page');
scripts.forEach((s, i) => { try { new vm.Script(s); } catch (e) { bad.push(`script ${i + 1} does not parse: ${e.message}`); } });

[['app bridge loaded', 'native.js'], ['bridge fallback', 'window.WM ||'], ['distance links', "WIX.links"], ['honesty recorded', 'honesty: honest.score'],
 ['splash', 'wm-splash'], ['three steps', 'data-step="3"'], ['camera screen', 'id="cam"'],
 ['manual capture', "id=\"manual\""], ['level check', "id='cal-1'".replace(/'/g, '"')],
 ['saves to World Mapper', 'wixapis.com'], ['daily reminder', 'BEGIN:VCALENDAR']]
  .forEach(([name, needle]) => { if (!html.includes(needle)) bad.push(`missing: ${name}`); });

if (bad.length) { console.error('Page check failed:\n - ' + bad.join('\n - ')); process.exit(1); }

// native.js must parse too, and must still do nothing on the web
const nat = fs.readFileSync(__dirname + '/../www/native.js', 'utf8');
try { new vm.Script(nat); } catch (e) { bad.push('native.js does not parse: ' + e.message); }
['rssiToMetres', 'linkFrom', 'honesty', 'dailyReminder', 'measureNeighbours'].forEach(f => {
  if (!nat.includes(f)) bad.push('native.js is missing ' + f);
});
if (bad.length) { console.error('Page check failed:\n - ' + bad.join('\n - ')); process.exit(1); }

console.log('Page check passed: ' + (html.length / 1024).toFixed(0) + ' KB, ' + scripts.length + ' scripts.');
