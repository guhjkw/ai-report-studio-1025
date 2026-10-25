/*
 * src/reportEngine.js
 * The logic behind Report Studio, an AI reporting app for marketing agencies. Loaded by the page (index.html)
 * and by the tests (tests/verify.js), so what you click is what was tested.
 *
 *   kpis(data, clientId, month)        every metric for the month: value, last month, change, 6-month history,
 *                                      where it comes from and how it is calculated
 *   anomalies(data, clientId, month)   breaks in the trend (a change unlike the previous months), big swings,
 *                                      and missing sources. A missing source is reported as missing, never estimated
 *   narrative(data, clientId, month)   the AI draft: plain-English sentences, each one carrying the exact numbers it uses
 *   verify(text, data, clientId, month) checks every number in any text (the draft or your edits) against the source
 *                                      data. A number it cannot trace is flagged, so a made-up figure never reaches a client
 *   videoScript(...)                   five talking points for the monthly video
 *   overview(data, month)              all clients at a glance: ready to send, or review first
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReportEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Each metric: where it comes from, how it is calculated, how it is shown, and which way is good.
  var METRICS = {
    leads:        { label: 'Leads', src: ['crm'], fmt: 'int', better: 'up', calc: function (m) { return m.crm.leads; }, formula: 'CRM: new leads' },
    booked:       { label: 'Booked jobs', src: ['crm'], fmt: 'int', better: 'up', calc: function (m) { return m.crm.booked; }, formula: 'CRM: leads that booked' },
    revenue:      { label: 'Booked revenue', src: ['crm'], fmt: 'usd0', better: 'up', calc: function (m) { return m.crm.revenue; }, formula: 'CRM: value of booked jobs' },
    closeRate:    { label: 'Close rate', src: ['crm'], fmt: 'pct1', better: 'up', calc: function (m) { return ratio(m.crm.booked, m.crm.leads, 100); }, formula: 'booked jobs / leads' },
    adSpend:      { label: 'Ad spend', src: ['ads'], fmt: 'usd0', better: 'none', calc: function (m) { return m.ads.spend; }, formula: 'Google Ads: cost' },
    adConversions:{ label: 'Ad conversions', src: ['ads'], fmt: 'int', better: 'up', calc: function (m) { return m.ads.conversions; }, formula: 'Google Ads: conversions' },
    adsCpl:       { label: 'Cost per ad lead', src: ['ads'], fmt: 'usd2', better: 'down', calc: function (m) { return ratio(m.ads.spend, m.ads.conversions, 1); }, formula: 'ad spend / ad conversions' },
    searchClicks: { label: 'Search clicks', src: ['gsc'], fmt: 'int', better: 'up', calc: function (m) { return m.gsc.clicks; }, formula: 'Search Console: clicks' },
    ctr:          { label: 'Search click rate', src: ['gsc'], fmt: 'pct2', better: 'up', calc: function (m) { return ratio(m.gsc.clicks, m.gsc.impressions, 100); }, formula: 'clicks / impressions' },
    avgPosition:  { label: 'Average position', src: ['gsc'], fmt: 'dec1', better: 'down', calc: function (m) { return m.gsc.position; }, formula: 'Search Console: average position' },
    sessions:     { label: 'Website sessions', src: ['ga4'], fmt: 'int', better: 'up', calc: function (m) { return m.ga4.sessions; }, formula: 'Analytics: sessions' },
    formFills:    { label: 'Form fills', src: ['ga4'], fmt: 'int', better: 'up', calc: function (m) { return m.ga4.conversions; }, formula: 'Analytics: form submissions' },
    mapsCalls:    { label: 'Calls from Maps', src: ['gbp'], fmt: 'int', better: 'up', calc: function (m) { return m.gbp.calls; }, formula: 'Business Profile: calls' },
    directions:   { label: 'Direction requests', src: ['gbp'], fmt: 'int', better: 'up', calc: function (m) { return m.gbp.directions; }, formula: 'Business Profile: direction requests' }
  };
  var SCAN = ['leads', 'booked', 'revenue', 'adsCpl', 'adSpend', 'searchClicks', 'avgPosition', 'sessions', 'formFills', 'mapsCalls'];

  function ratio(a, b, k) { return a == null || b == null || !b ? null : a / b * k; }
  function settingsOf(data, opts) { var s = {}, d = data.settings || {}, o = opts || {}; Object.keys(d).forEach(function (k) { s[k] = d[k]; }); Object.keys(o).forEach(function (k) { s[k] = o[k]; }); return s; }
  function clientOf(data, id) { return (data.clients || []).filter(function (c) { return c.id === id; })[0] || null; }
  function monthName(ym) { var p = String(ym).split('-'); return MONTH_NAMES[+p[1] - 1]; }

  function fmt(v, f) {
    if (v == null || isNaN(v)) return 'n/a';
    if (f === 'int') return Math.round(v).toLocaleString('en-US');
    if (f === 'usd0') return '$' + Math.round(v).toLocaleString('en-US');
    if (f === 'usd2') return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (f === 'pct1') return v.toFixed(1) + '%';
    if (f === 'pct2') return v.toFixed(2) + '%';
    if (f === 'dec1') return v.toFixed(1);
    return String(v);
  }
  function pctChange(cur, prev) { return cur == null || prev == null || !prev ? null : (cur - prev) / prev * 100; }

  // The raw numbers for one month, or null where the source sent nothing.
  function snapshot(client, i) {
    var s = client.series, out = {};
    Object.keys(s).forEach(function (src) { out[src] = {}; Object.keys(s[src]).forEach(function (k) { var v = s[src][k][i]; out[src][k] = v == null ? null : v; }); });
    return out;
  }

  /* ---------- KPIs ---------- */
  function kpis(data, clientId, month) {
    var c = clientOf(data, clientId), i = data.months.indexOf(month);
    if (!c) return { ok: false, error: 'unknown client ' + clientId };
    if (i < 0) return { ok: false, error: 'no data for ' + month };
    var out = {};
    Object.keys(METRICS).forEach(function (k) {
      var M = METRICS[k], hist = data.months.map(function (_, j) { var v = M.calc(snapshot(c, j)); return v == null ? null : v; });
      var cur = hist[i], prev = i > 0 ? hist[i - 1] : null, mom = pctChange(cur, prev);
      out[k] = { key: k, label: M.label, value: cur, prev: prev, mom: mom, history: hist.slice(0, i + 1), fmt: M.fmt, better: M.better,
        sources: M.src.map(function (s) { return data.sources[s]; }), formula: M.formula, missing: cur == null,
        display: fmt(cur, M.fmt), prevDisplay: fmt(prev, M.fmt),
        trend: mom == null ? 'flat' : Math.abs(mom) < 0.5 ? 'flat' : mom > 0 ? 'up' : 'down',
        good: mom == null || M.better === 'none' ? null : (M.better === 'up') === (mom > 0) };
    });
    return { ok: true, client: c, month: month, monthName: monthName(month), prevMonthName: i > 0 ? monthName(data.months[i - 1]) : null, metrics: out };
  }

  /* ---------- anomalies ---------- */
  function anomalies(data, clientId, month, opts) {
    var k = kpis(data, clientId, month); if (!k.ok) return k;
    var s = settingsOf(data, opts), list = [], gaps = [];
    // A source is missing when every metric that depends only on it is empty this month.
    Object.keys(data.sources).forEach(function (src) {
      var own = Object.keys(METRICS).filter(function (m) { return METRICS[m].src.length === 1 && METRICS[m].src[0] === src; });
      if (own.length && own.every(function (m) { return k.metrics[m].missing; }))
        gaps.push({ source: src, sourceName: data.sources[src], text: data.sources[src] + ' sent no data for ' + k.monthName + '. Those numbers are left out, not estimated. Reconnect it before sending.' });
    });
    SCAN.forEach(function (key) {
      var m = k.metrics[key]; if (m.missing || m.mom == null) return;
      // Compare this month's change with the changes of the months before it.
      var h = m.history, changes = [];
      for (var j = 1; j < h.length - 1; j++) { var c = pctChange(h[j], h[j - 1]); if (c != null) changes.push(c); }
      var z = null;
      if (changes.length >= 3) {
        var mean = changes.reduce(function (a, b) { return a + b; }, 0) / changes.length;
        var sd = Math.sqrt(changes.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / changes.length);
        if (sd > 0.0001) z = (m.mom - mean) / sd;
      }
      var big = Math.abs(m.mom) >= s.momThreshold, breakTrend = z != null && Math.abs(z) >= s.zThreshold && Math.abs(m.mom) >= (s.minTrendChange || 8);
      if (!big && !breakTrend) return;
      var type = m.better === 'none' ? 'change' : m.good ? 'win' : 'risk';
      var severity = (big && breakTrend) || Math.abs(m.mom) >= 2 * s.momThreshold ? 'high' : 'medium';
      list.push({ key: key, label: m.label, type: type, severity: severity, mom: m.mom, z: z == null ? null : Math.round(z * 10) / 10,
        value: m.value, prev: m.prev, display: m.display, prevDisplay: m.prevDisplay,
        why: (big ? 'moved ' + Math.round(Math.abs(m.mom)) + '% in a month' : '') + (big && breakTrend ? ' and ' : '') + (breakTrend ? 'breaks the trend of the previous months' : '') });
    });
    var rank = { high: 0, medium: 1 }, trank = { risk: 0, change: 1, win: 2 };
    list.sort(function (a, b) { return rank[a.severity] - rank[b.severity] || trank[a.type] - trank[b.type] || Math.abs(b.mom) - Math.abs(a.mom); });
    return { ok: true, items: list, gaps: gaps, risks: list.filter(function (x) { return x.type === 'risk'; }).length };
  }

  /* ---------- the AI draft ---------- */
  function ref(m, which) {
    if (which === 'mom') return { key: m.key + '.mom', label: m.label + ' change', value: Math.round(Math.abs(m.mom)), text: Math.round(Math.abs(m.mom)) + '%' };
    if (which === 'prev') return { key: m.key + '.prev', label: m.label + ' last month', value: m.prev, text: m.prevDisplay };
    return { key: m.key, label: m.label, value: m.value, text: m.display };
  }
  function narrative(data, clientId, month, opts) {
    var k = kpis(data, clientId, month); if (!k.ok) return k;
    var a = anomalies(data, clientId, month, opts), M = k.metrics, out = [], mn = k.monthName, pm = k.prevMonthName;
    // Each sentence is for the client, or a note for the agency team that never goes into the client report.
    function say(text, refs, kind, audience) { out.push({ text: text, refs: refs, kind: kind || 'insight', audience: audience || 'client' }); }
    var flagged = {}; a.items.forEach(function (x) { flagged[x.key] = x; });

    if (!M.leads.missing) {
      var dir = M.leads.trend === 'up' ? 'rose' : M.leads.trend === 'down' ? 'fell' : 'held';
      say('Leads ' + dir + (M.leads.trend === 'flat' ? ' at ' + M.leads.display : ' ' + ref(M.leads, 'mom').text + ' to ' + M.leads.display) + ' in ' + mn + ', and ' + M.booked.display + ' of them booked a job (' + M.closeRate.display + ' close rate).',
        [ref(M.leads, 'mom'), ref(M.leads), ref(M.booked), ref(M.closeRate)].filter(function (r, i) { return !(i === 0 && M.leads.trend === 'flat'); }), 'headline');
    }
    if (!M.revenue.missing && M.revenue.mom != null)
      say('Booked revenue ' + (M.revenue.mom >= 0 ? 'reached ' : 'came in at ') + M.revenue.display + ', ' + (M.revenue.mom >= 0 ? 'up ' : 'down ') + ref(M.revenue, 'mom').text + ' on ' + pm + '.', [ref(M.revenue), ref(M.revenue, 'mom')]);
    if (!M.adsCpl.missing && M.adsCpl.prev != null) {
      if (flagged.adsCpl && flagged.adsCpl.type === 'risk')
      { say('Cost per ad lead rose ' + ref(M.adsCpl, 'mom').text + ' to ' + M.adsCpl.display + ' (from ' + M.adsCpl.prevDisplay + ') as ad spend went to ' + M.adSpend.display + '.',
          [ref(M.adsCpl, 'mom'), ref(M.adsCpl), ref(M.adsCpl, 'prev'), ref(M.adSpend)], 'risk');
        say('Check the new spend (search terms, locations, any new campaigns) before the client call.', [], 'risk', 'team'); }
      else
        say('Google Ads brought ' + M.adConversions.display + ' conversions at ' + M.adsCpl.display + ' each, ' + (M.adsCpl.value <= M.adsCpl.prev ? 'down' : 'up') + ' from ' + M.adsCpl.prevDisplay + '.', [ref(M.adConversions), ref(M.adsCpl), ref(M.adsCpl, 'prev')]);
    }
    if (!M.searchClicks.missing && M.searchClicks.prev != null) {
      if (flagged.searchClicks && flagged.searchClicks.type === 'risk')
      { say('Search clicks fell ' + ref(M.searchClicks, 'mom').text + ' to ' + M.searchClicks.display + ', and the average position slipped from ' + M.avgPosition.prevDisplay + ' to ' + M.avgPosition.display + '.',
          [ref(M.searchClicks, 'mom'), ref(M.searchClicks), ref(M.avgPosition, 'prev'), ref(M.avgPosition)], 'risk');
        say('Check for a ranking drop on the top pages or a tracking change before the client call.', [], 'risk', 'team'); }
      else
        say('Search clicks ' + (M.searchClicks.value >= M.searchClicks.prev ? 'grew' : 'eased') + ' to ' + M.searchClicks.display + ' and the average position ' + (M.avgPosition.value <= M.avgPosition.prev ? 'improved' : 'moved') + ' from ' + M.avgPosition.prevDisplay + ' to ' + M.avgPosition.display + '.',
          [ref(M.searchClicks), ref(M.avgPosition, 'prev'), ref(M.avgPosition)]);
    }
    if (flagged.searchClicks && flagged.searchClicks.type === 'risk' && flagged.sessions && flagged.sessions.type === 'risk' && flagged.formFills && flagged.formFills.type === 'risk')
      say('Website sessions and form fills fell with it: ' + M.sessions.display + ' sessions (down ' + ref(M.sessions, 'mom').text + ') and ' + M.formFills.display + ' form fills (down ' + ref(M.formFills, 'mom').text + ').',
        [ref(M.sessions), ref(M.sessions, 'mom'), ref(M.formFills), ref(M.formFills, 'mom')], 'risk');
    if (!M.mapsCalls.missing && M.mapsCalls.prev != null)
      say('Calls from the Maps listing came to ' + M.mapsCalls.display + ' (' + M.mapsCalls.prevDisplay + ' in ' + pm + ').', [ref(M.mapsCalls), ref(M.mapsCalls, 'prev')]);
    a.gaps.forEach(function (g) {
      say(g.sourceName + ' data was not available for ' + mn + ', so it is not included this month.', [], 'gap');
      say('Reconnect ' + g.sourceName + ' before sending. Its numbers are left out, not estimated.', [], 'gap', 'team');
    });
    var risk = a.items.filter(function (x) { return x.type === 'risk'; })[0];
    var topic = !risk ? '' : flagged.searchClicks && flagged.searchClicks.type === 'risk' ? 'drop in search clicks'
      : flagged.adsCpl && flagged.adsCpl.type === 'risk' ? 'jump in cost per ad lead' : risk.label.toLowerCase();
    if (risk) say('Before sending: get to the bottom of the ' + topic + ', and lead the call with what you found.', [], 'action', 'team');
    else say('Next month: we keep the budget steady and build on what is working.', [], 'action', 'client');
    var client = out.filter(function (s) { return s.audience === 'client'; });
    return { ok: true, sentences: out, text: out.map(function (s) { return s.text; }).join(' '), clientText: client.map(function (s) { return s.text; }).join(' ') };
  }

  /* ---------- verification ---------- */
  // Every number the report could legitimately state for this client and month.
  function candidates(data, clientId, month) {
    var k = kpis(data, clientId, month), list = [];
    if (!k.ok) return list;
    Object.keys(k.metrics).forEach(function (key) {
      var m = k.metrics[key];
      if (m.value != null) list.push({ key: key, label: m.label + ', ' + k.monthName, value: m.value, pct: /pct/.test(m.fmt), money: /usd/.test(m.fmt) });
      if (m.prev != null) list.push({ key: key + '.prev', label: m.label + ', ' + k.prevMonthName, value: m.prev, pct: /pct/.test(m.fmt), money: /usd/.test(m.fmt) });
      if (m.mom != null) list.push({ key: key + '.mom', label: m.label + ' change', value: Math.abs(m.mom), pct: true, money: false });
    });
    return list;
  }
  var NUM = /(\$)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(k|K)?(%)?/g;
  function verify(text, data, clientId, month) {
    // A sentence ends at . ! or ? followed by a space, so decimals like $50.70 never split a sentence.
    var cands = candidates(data, clientId, month), sentences = String(text || '').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
    var all = [];
    var out = sentences.map(function (s) {
      var nums = [], m; NUM.lastIndex = 0;
      while ((m = NUM.exec(s))) {
        var raw = m[0].trim(), money = !!m[1], pct = !!m[5], kilo = !!m[4];
        var intPart = m[2].replace(/,/g, ''), dec = m[3] ? m[3].length - 1 : 0, val = parseFloat(intPart + (m[3] || ''));
        if (!money && !pct && !kilo && !m[3] && val >= 2000 && val <= 2100 && intPart.length === 4) continue;   // a year, not a metric
        var scale = kilo ? 1000 : 1, step = Math.pow(10, -dec) * scale;
        var hit = cands.filter(function (c) {
          if (pct !== c.pct) return false;
          if (money && !c.money) return false;
          return Math.abs(Math.round(c.value / step) * step - val * scale) < step / 2;
        })[0];
        var item = { raw: raw, ok: !!hit, key: hit ? hit.key : null, label: hit ? hit.label : null };
        nums.push(item); all.push(item);
      }
      return { text: s.trim(), numbers: nums, status: nums.length === 0 ? 'no-numbers' : nums.every(function (n) { return n.ok; }) ? 'verified' : 'flagged' };
    });
    var bad = all.filter(function (n) { return !n.ok; });
    return { sentences: out, checked: all.length, verified: all.length - bad.length, flagged: bad, ok: bad.length === 0 };
  }

  /* ---------- video script and overview ---------- */
  function videoScript(data, clientId, month, opts) {
    var k = kpis(data, clientId, month); if (!k.ok) return k;
    var a = anomalies(data, clientId, month, opts), M = k.metrics, c = k.client;
    var win = a.items.filter(function (x) { return x.type === 'win'; })[0];
    var risk = a.items.filter(function (x) { return x.type === 'risk'; })[0];
    return { ok: true, points: [
      'Open: "Hi ' + c.contact + ', here is ' + k.monthName + ' for ' + c.name + ' in two minutes."',
      'The number: ' + M.leads.display + ' leads and ' + M.booked.display + ' booked jobs' + (M.revenue.missing ? '' : ', worth ' + M.revenue.display) + '.',
      win ? 'The win: ' + win.label.toLowerCase() + ' moved from ' + win.prevDisplay + ' to ' + win.display + '.' : 'The win: steady results on the channels that matter, with no surprises.',
      risk ? 'What we are fixing: ' + risk.label.toLowerCase() + ' went from ' + risk.prevDisplay + ' to ' + risk.display + '. Say what you will check this week.' : a.gaps.length ? 'Housekeeping: ' + a.gaps[0].sourceName + ' needs reconnecting, so a few numbers are missing this month.' : 'Nothing needs fixing this month.',
      'Close: one thing we will do next month, and an invitation to reply with questions.'
    ] };
  }
  function overview(data, month, opts) {
    return data.clients.map(function (c) {
      var k = kpis(data, c.id, month), a = anomalies(data, c.id, month, opts);
      var risks = a.items.filter(function (x) { return x.type === 'risk'; });
      return { id: c.id, name: c.name, leads: k.metrics.leads.display, leadsMom: k.metrics.leads.mom, risks: risks.length, gaps: a.gaps.length,
        status: risks.some(function (x) { return x.severity === 'high'; }) || a.gaps.length ? 'review' : 'ready' };
    });
  }
  function shareLink(data, clientId, month) {
    var c = clientOf(data, clientId); if (!c) return null;
    return data.agency.shareBase + c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + month;
  }

  return { METRICS: METRICS, kpis: kpis, anomalies: anomalies, narrative: narrative, verify: verify, videoScript: videoScript,
    overview: overview, shareLink: shareLink, fmt: fmt, monthName: monthName };
});
