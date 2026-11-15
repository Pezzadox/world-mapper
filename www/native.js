/* World Mapper: the parts that only work inside the installed app.
 *
 * On the website every one of these quietly does nothing, and the page behaves exactly
 * as it always has. Inside the app they add three things:
 *
 *   1. a real daily notification at noon
 *   2. checks that make a faked reading hard to pass off as a real one
 *   3. phone-to-phone distance measuring over Bluetooth
 *
 * The third is the important one. Every reading records where the phone was using GPS,
 * which is calculated on the assumption of a round Earth — fine for checking that the
 * app measures angles properly, useless for settling the question it was built to settle.
 * Distances measured between phones assume nothing. Enough of them, chained together,
 * give the layout of the world on their own.
 */
(function (root) {
  'use strict';

  /* ---------- the maths, kept pure so it can be tested on its own ---------- */

  // Signal strength falls off with distance. txPower is what a phone one metre away reads,
  // n is how fast the signal fades: about 2 in the open, higher indoors with walls in the way.
  function rssiToMetres(rssi, txPower, n) {
    txPower = txPower === undefined ? -59 : txPower;
    n = n === undefined ? 2.0 : n;
    return Math.pow(10, (txPower - rssi) / (10 * n));
  }

  function median(xs) {
    if (!xs || !xs.length) return null;
    var a = xs.slice().sort(function (x, y) { return x - y; }), h = a.length >> 1;
    return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
  }

  // One phone seen over a run of samples becomes one link, with an honest spread rather
  // than a single confident number: the middle half of the samples sets the range.
  function linkFrom(peer, opts) {
    opts = opts || {};
    var rssi = (peer.rssi || []).filter(function (v) { return typeof v === 'number' && v < 0 && v > -127; });
    if (rssi.length < 5) return null;
    var sorted = rssi.slice().sort(function (a, b) { return a - b; });
    var lo = sorted[Math.floor(sorted.length * 0.25)], hi = sorted[Math.floor(sorted.length * 0.75)];
    var mid = median(rssi);
    var metres = rssiToMetres(mid, opts.txPower, opts.n);
    return {
      other: peer.id,
      metres: +metres.toFixed(1),
      // a strong sample reads high, so the strongest sample gives the near edge of the range
      nearM: +rssiToMetres(hi, opts.txPower, opts.n).toFixed(1),
      farM: +rssiToMetres(lo, opts.txPower, opts.n).toFixed(1),
      samples: rssi.length,
      medianRssi: mid
    };
  }

  // What the phone reports about itself, turned into one number and a list of plain reasons.
  // This never blocks a reading. It records what was true at the time and lets the analysis decide.
  function honesty(info) {
    info = info || {};
    var score = 100, why = [];
    function off(n, reason) { score -= n; why.push(reason); }
    if (info.emulator) off(60, 'not a real phone');
    if (info.jailbroken) off(40, 'phone has been jailbroken');
    if (info.mockLocationAllowed) off(25, 'fake locations are switched on');
    if (info.debuggable) off(10, 'development build');
    if (info.clockOffsetS != null && Math.abs(info.clockOffsetS) > 120) off(30, 'phone clock is out by ' + Math.round(info.clockOffsetS) + 's');
    else if (info.clockOffsetS != null && Math.abs(info.clockOffsetS) > 20) off(10, 'phone clock is slightly out');
    if (info.gravity != null && Math.abs(info.gravity - 9.81) > 1.5) off(40, 'gravity reads ' + info.gravity.toFixed(1) + ', not 9.8');
    if (info.jitter != null && info.jitter < 0.0005) off(50, 'sensor values are frozen');
    if (info.sampleRate != null && info.sampleRate < 5) off(15, 'sensors reporting slowly');
    return { score: Math.max(0, score), why: why };
  }

  /* ---------- the bridge into the app, if there is one ---------- */

  var cap = root.Capacitor, has = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  function plugin(name) { try { return cap.Plugins[name] || (cap.registerPlugin && cap.registerPlugin(name)); } catch (e) { return null; } }

  var WM = {
    inApp: has,
    rssiToMetres: rssiToMetres,
    linkFrom: linkFrom,
    honesty: honesty,
    median: median,

    /* A real notification at noon, every day, from the phone itself. */
    dailyReminder: function (hour) {
      if (!has) return Promise.resolve({ ok: false, reason: 'web' });
      var LN = plugin('LocalNotifications');
      if (!LN) return Promise.resolve({ ok: false, reason: 'no notifications' });
      return LN.requestPermissions().then(function (p) {
        if (p.display !== 'granted') return { ok: false, reason: 'refused' };
        return LN.schedule({
          notifications: [{
            id: 1,
            title: 'World Mapper',
            body: 'Time for today’s reading. Point your phone at the Sun.',
            schedule: { on: { hour: hour === undefined ? 12 : hour, minute: 0 }, allowWhileIdle: true },
            smallIcon: 'ic_stat_worldmapper'
          }]
        }).then(function () { return { ok: true }; });
      }).catch(function (e) { return { ok: false, reason: String(e && e.message || e) }; });
    },

    cancelReminder: function () {
      if (!has) return Promise.resolve();
      var LN = plugin('LocalNotifications');
      return LN ? LN.cancel({ notifications: [{ id: 1 }] }).catch(function () { }) : Promise.resolve();
    },

    /* What the phone says about itself, plus how far its clock is from the server's. */
    checks: function (serverTimeUrl) {
      var out = { platform: has ? 'app' : 'web' };
      var jobs = [];
      if (has) {
        var R = plugin('WmRanging');
        if (R && R.deviceChecks) jobs.push(R.deviceChecks().then(function (d) {
          out.emulator = d.emulator; out.jailbroken = d.jailbroken;
          out.debuggable = d.debuggable; out.mockLocationAllowed = d.mockLocationAllowed;
          out.platform = d.platform;
        }).catch(function () { }));
      }
      // A phone's own clock can be set to anything. The server's Date header is the reference.
      if (location.protocol !== 'file:') jobs.push(fetch(serverTimeUrl || (location.origin + location.pathname), { method: 'HEAD', cache: 'no-store' })
        .then(function (res) {
          var d = res.headers.get('date');
          if (d) out.clockOffsetS = (Date.now() - new Date(d).getTime()) / 1000;
        }).catch(function () { }));
      return Promise.all(jobs).then(function () { return out; });
    },

    /* A second of raw accelerometer data. Gravity should read 9.8 and should never sit perfectly still. */
    sensorBurst: function (ms) {
      ms = ms || 1000;
      return new Promise(function (resolve) {
        var mags = [], t0 = Date.now(), handler = function (e) {
          var a = e.accelerationIncludingGravity;
          if (a && a.x != null) mags.push(Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z));
        };
        try { root.addEventListener('devicemotion', handler); } catch (e) { return resolve({}); }
        setTimeout(function () {
          try { root.removeEventListener('devicemotion', handler); } catch (e) { }
          if (mags.length < 3) return resolve({});
          var mean = mags.reduce(function (a, b) { return a + b; }, 0) / mags.length;
          var varc = mags.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / mags.length;
          resolve({ gravity: mean, jitter: Math.sqrt(varc), sampleRate: mags.length / (Date.now() - t0) * 1000 });
        }, ms);
      });
    },

    /* ---------- phone-to-phone distance ---------- */

    canMeasureDistance: function () {
      if (!has) return Promise.resolve({ available: false, reason: 'only in the app' });
      var R = plugin('WmRanging');
      if (!R) return Promise.resolve({ available: false, reason: 'not built in' });
      return R.available().catch(function (e) { return { available: false, reason: String(e && e.message || e) }; });
    },

    /* Runs for a few seconds, then hands back one link per phone found nearby. */
    measureNeighbours: function (myId, seconds, opts) {
      if (!has) return Promise.resolve([]);
      var R = plugin('WmRanging');
      if (!R) return Promise.resolve([]);
      return R.start({ id: myId }).then(function () {
        return new Promise(function (r) { setTimeout(r, (seconds || 8) * 1000); });
      }).then(function () {
        return R.results();
      }).then(function (res) {
        R.stop().catch(function () { });
        return (res.peers || []).map(function (p) { return linkFrom(p, opts); })
          .filter(Boolean)
          .sort(function (a, b) { return a.metres - b.metres; });
      }).catch(function () {
        try { R.stop(); } catch (e) { }
        return [];
      });
    }
  };

  root.WM = WM;
  if (typeof module !== 'undefined' && module.exports) module.exports = WM;   // so the maths can be tested
})(typeof window !== 'undefined' ? window : globalThis);
