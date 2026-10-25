/*
 * tests/verify.js
 * Node tests against src/reportEngine.js, the same file the page loads.
 * Run: node tests/verify.js        (the last line must say "0 failed")
 */
'use strict';
var R = require('../src/reportEngine.js');
var D = require('../data/clients.json');
var passed = 0, failed = 0;
function check(name, cond) { if (cond) { passed++; console.log('PASS: ' + name); } else { failed++; console.log('FAIL: ' + name); } }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
var OCT = '2026-10';

console.log('1. KPIs from the raw source data');
var k = R.kpis(D, 'oakhollow', OCT), M = k.metrics;
check('October leads for Oakhollow: 192', M.leads.value === 192 && M.leads.display === '192');
check('close rate is booked / leads: 45 / 192 = 23.4%', M.closeRate.display === '23.4%');
check('cost per ad lead is spend / conversions: $3,600 / 76 = $47.37', M.adsCpl.display === '$47.37');
check('last month is shown next to it: $50.70', M.adsCpl.prevDisplay === '$50.70');
check('search click rate: 1,595 / 53,600 = 2.98%', M.ctr.display === '2.98%');
check('leads changed +7.9% on September', Math.abs(M.leads.mom - 7.865) < 0.01 && M.leads.trend === 'up');
check('lower cost per lead counts as good', M.adsCpl.good === true);
check('a better average position (smaller number) counts as good', M.avgPosition.good === true);
check('ad spend has no good or bad direction', M.adSpend.good === null);
check('history holds every month up to the selected one', M.leads.history.length === 6 && R.kpis(D, 'oakhollow', '2026-07').metrics.leads.history.length === 3);
check('Business Profile calls are missing in October, shown as n/a', M.mapsCalls.missing && M.mapsCalls.display === 'n/a');
check('each metric names its source and formula', M.adsCpl.sources[0] === 'Google Ads' && M.adsCpl.formula === 'ad spend / ad conversions');
check('the first month has no change to compare', R.kpis(D, 'oakhollow', '2026-05').metrics.leads.mom === null);
check('unknown client is refused', !R.kpis(D, 'nobody', OCT).ok);
check('a month with no data is refused', !R.kpis(D, 'oakhollow', '2027-01').ok);

console.log('2. Anomalies, trend breaks and gaps');
var aB = R.anomalies(D, 'bluebarrow', OCT), aK = R.anomalies(D, 'kestrel', OCT), aO = R.anomalies(D, 'oakhollow', OCT);
check('Bluebarrow: cost per ad lead flagged as a high risk', aB.items[0].key === 'adsCpl' && aB.items[0].type === 'risk' && aB.items[0].severity === 'high');
check('Bluebarrow: the spend change is reported as a change, not a risk', aB.items.some(function (x) { return x.key === 'adSpend' && x.type === 'change'; }));
check('Kestrel: search clicks flagged as a high risk (down 38%)', aK.items.some(function (x) { return x.key === 'searchClicks' && x.type === 'risk' && x.severity === 'high' && Math.round(x.mom) === -38; }));
check('Kestrel: worse average position is a risk even though the number went up', aK.items.some(function (x) { return x.key === 'avgPosition' && x.type === 'risk'; }));
check('Oakhollow: steady growth is not a risk', aO.risks === 0);
check('Oakhollow: the missing Business Profile month is a gap, not an anomaly', aO.gaps.length === 1 && aO.gaps[0].source === 'gbp' && !aO.items.some(function (x) { return x.key === 'mapsCalls'; }));
check('risks are listed before wins', aK.items[0].type === 'risk');
check('a stricter threshold flags fewer things', R.anomalies(D, 'bluebarrow', OCT, { momThreshold: 80, zThreshold: 50 }).items.length < aB.items.length);
check('a looser threshold flags more things', R.anomalies(D, 'oakhollow', OCT, { momThreshold: 5 }).items.length > aO.items.length);
var flat = clone(D); flat.clients[0].series.crm.leads = [100, 100, 100, 100, 100, 100];
check('a perfectly flat history does not crash the trend check', R.anomalies(flat, 'oakhollow', OCT).ok);

console.log('3. The AI draft');
var nK = R.narrative(D, 'kestrel', OCT), nB = R.narrative(D, 'bluebarrow', OCT), nO = R.narrative(D, 'oakhollow', OCT);
check('headline sentence first', nK.sentences[0].kind === 'headline' && /^Leads fell 12% to 103 in October/.test(nK.sentences[0].text));
check('Kestrel draft explains the search drop to the client', nK.sentences.some(function (s) { return s.kind === 'risk' && s.audience === 'client' && /Search clicks fell 38% to 561/.test(s.text); }));
check('and tells the team what to check, in a note the client never sees', nK.sentences.some(function (s) { return s.audience === 'team' && /Check for a ranking drop/.test(s.text); }) && !/Check for/.test(nK.clientText));
check('Bluebarrow draft explains the cost per lead jump', nB.sentences.some(function (s) { return /Cost per ad lead rose 64% to \$50\.82 \(from \$31\.08\)/.test(s.text); }));
check('Oakhollow draft reports the missing source instead of guessing', /Business Profile data was not available for October/.test(nO.clientText) && !/Maps listing came to/.test(nO.text));
check('the client text leaves out every team note', [nK, nB, nO].every(function (n) { return !/Before sending|Reconnect|Check (for|the new)/.test(n.clientText); }));
check('with no risk, the close is a client-facing next step', nO.sentences[nO.sentences.length - 1].audience === 'client');
check('every sentence carries the numbers it uses', nK.sentences.filter(function (s) { return /\d/.test(s.text); }).every(function (s) { return s.refs.length > 0; }));
check('the draft ends with an action', nK.sentences[nK.sentences.length - 1].kind === 'action');

console.log('4. Verification: every number traced to the data');
var all = true;
D.clients.forEach(function (c) { D.months.slice(1).forEach(function (m) { var n = R.narrative(D, c.id, m); if (!R.verify(n.text, D, c.id, m).ok || !R.verify(n.clientText, D, c.id, m).ok) all = false; }); });
check('all 15 drafts (3 clients x 5 months) verify 100%, team and client versions', all);
var v1 = R.verify('Leads rose 8% to 192 in October. Close rate was 52%.', D, 'oakhollow', OCT);
check('an invented number is flagged (52%)', !v1.ok && v1.flagged.length === 1 && v1.flagged[0].raw === '52%');
check('the true numbers still pass', v1.sentences[0].status === 'verified' && v1.sentences[1].status === 'flagged');
check('decimals do not split sentences: "$47.37" stays whole', R.verify('Ads cost $47.37 per lead, down from $50.70.', D, 'oakhollow', OCT).ok);
check('rounded money is accepted: "$279k" matches $279,000', R.verify('Revenue hit $279k.', D, 'oakhollow', OCT).ok);
check('a rounded but wrong value is caught: "$280k"', !R.verify('Revenue hit $280k.', D, 'oakhollow', OCT).ok);
check('a percent must match a percent: "192%" is flagged', !R.verify('Leads were 192%.', D, 'oakhollow', OCT).ok);
check('a year is not treated as a metric', R.verify('In 2026 leads were 192.', D, 'oakhollow', OCT).ok);
check('another client\'s number is flagged here', !R.verify('Leads were 165.', D, 'oakhollow', OCT).ok);
check('last month\'s value is allowed when stated', R.verify('Up from 178 leads.', D, 'oakhollow', OCT).ok);
check('text with no numbers is not flagged', R.verify('Great month, well done.', D, 'oakhollow', OCT).ok);

console.log('5. Video script, overview and share link');
var vs = R.videoScript(D, 'bluebarrow', OCT);
check('five talking points, opening with the client contact', vs.points.length === 5 && /Hi Marcus/.test(vs.points[0]));
check('the fix point names the real problem', /cost per ad lead went from \$31\.08 to \$50\.82/.test(vs.points[3]));
var ov = R.overview(D, OCT);
check('overview lists every client', ov.length === 3);
check('clients with high risks or gaps need review', ov.every(function (o) { return o.status === 'review'; }));
check('September: Oakhollow is ready to send', R.overview(D, '2026-09').filter(function (o) { return o.id === 'oakhollow'; })[0].status === 'ready');
check('share link is readable', R.shareLink(D, 'kestrel', OCT) === 'https://reports.fieldline.example/r/kestrel-electric-2026-10');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
