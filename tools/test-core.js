// Tests for the maths in www/native.js. Run: node tools/test-core.js
const WM = require('../www/native.js');
let fails = 0, n = 0;
function is(name, got, want, tol) {
  n++;
  const ok = tol === undefined ? JSON.stringify(got) === JSON.stringify(want) : Math.abs(got - want) <= tol;
  if (!ok) { fails++; console.error('FAIL ' + name + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)); }
}

// --- distance from signal strength
is('one metre reads as one metre', WM.rssiToMetres(-59), 1, 0.01);
is('ten metres', WM.rssiToMetres(-79), 10, 0.1);
is('weaker signal means further away', WM.rssiToMetres(-90) > WM.rssiToMetres(-70), true);
is('indoors fading makes the same signal look nearer', WM.rssiToMetres(-79, -59, 3) < WM.rssiToMetres(-79, -59, 2), true);

// --- turning a run of samples into one link
const steady = { id: 'p-abc123', rssi: Array(40).fill(-79) };
const link = WM.linkFrom(steady);
is('a steady run gives its distance', link.metres, 10, 0.2);
is('and names the other phone', link.other, 'p-abc123');
is('a noisy run still gives a sane middle', WM.linkFrom({ id: 'p-x', rssi: [-70, -95, -79, -78, -80, -79, -60, -79, -79, -81] }).metres, 10, 3);
is('the range brackets the answer (quartiles can land on the middle)', (() => { const l = WM.linkFrom({ id: 'p-x', rssi: [-70, -75, -79, -83, -88, -79, -79, -79] }); return l.nearM <= l.metres && l.metres <= l.farM; })(), true);
is('too few samples is no link at all', WM.linkFrom({ id: 'p-x', rssi: [-79, -79] }), null);
is('unreadable values are thrown out', WM.linkFrom({ id: 'p-x', rssi: [127, 127, 127, 127, 127, 127] }), null);
is('a phone close by reads under a metre', WM.linkFrom({ id: 'p-x', rssi: Array(10).fill(-45) }).metres < 1, true);

// --- the honesty score
is('an ordinary phone scores full marks', WM.honesty({ gravity: 9.79, jitter: 0.02, sampleRate: 50, clockOffsetS: 1 }).score, 100);
is('an emulator is marked down hard', WM.honesty({ emulator: true }).score <= 40, true);
is('frozen sensors are caught', WM.honesty({ jitter: 0.0001 }).why.join(), 'sensor values are frozen');
is('wrong gravity is caught', WM.honesty({ gravity: 3.2 }).why[0].indexOf('gravity') === 0, true);
is('a wound-forward clock is caught', WM.honesty({ clockOffsetS: 3600 }).why[0].indexOf('clock is out') > 0, true);
is('a small clock drift is forgiven', WM.honesty({ clockOffsetS: 5 }).score, 100);
is('nothing known scores full marks rather than guessing', WM.honesty({}).score, 100);
is('the score never goes below zero', WM.honesty({ emulator: true, jailbroken: true, jitter: 0, gravity: 0, mockLocationAllowed: true }).score >= 0, true);

// --- the web page must be untouched by any of this
is('no app means no reminder', typeof WM.dailyReminder, 'function');
WM.measureNeighbours('p-me', 1).then(r => {
  is('no app means no neighbours', r, []);
  console.log(fails ? fails + ' of ' + n + ' checks FAILED' : 'All ' + n + ' checks passed.');
  process.exit(fails ? 1 : 0);
});
