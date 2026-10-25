"""
tests/browser-check.py
Playwright checks that drive the real page (index.html), which loads the same src/reportEngine.js
that tests/verify.js tests.
Run:  python3 tests/browser-check.py      (expects "0 failed" on the last line)
"""
import functools, http.server, pathlib, threading
from html.parser import HTMLParser
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests"
passed = failed = 0
def check(name, cond):
    global passed, failed
    if cond: passed += 1; print(f"PASS: {name}")
    else: failed += 1; print(f"FAIL: {name}")

class Balance(HTMLParser):
    VOID = {"meta","link","br","input","img","hr","source","wbr","col","path","rect","circle","stop"}
    def __init__(self): super().__init__(); self.stack, self.errors = [], []
    def handle_starttag(self, tag, attrs):
        if tag not in self.VOID: self.stack.append(tag)
    def handle_startendtag(self, tag, attrs): pass
    def handle_endtag(self, tag):
        if tag in self.VOID: return
        if not self.stack or self.stack[-1] != tag: self.errors.append(f"unexpected </{tag}> open {self.stack[-3:]}")
        else: self.stack.pop()

print("0. HTML tag balance")
b = Balance(); b.feed((ROOT / "index.html").read_text())
check("all tags closed and nested", not b.errors and not b.stack)

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)); handler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler); threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_address[1]}/index.html"
problems = []

with sync_playwright() as pw:
    br = pw.chromium.launch()
    pg = br.new_page(viewport={"width": 1440, "height": 900})
    pg.on("console", lambda m: problems.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: problems.append(str(e)))
    pg.goto(url); pg.wait_for_function("document.querySelectorAll('#kgrid .kcard').length === 6")
    txt = lambda sel: pg.locator(sel).first.text_content().strip()

    print("1. Dashboard")
    check("opens on Kestrel Electric, October", txt("#cName") == "Kestrel Electric" and "October 2026" in txt("#cMeta"))
    check("leads card shows 103 and a red -12.0% change", "103" in txt("#kgrid .kcard[data-k=leads]") and "-12.0%" in txt("#kgrid .kcard[data-k=leads] .delta.bad"))
    check("search clicks drop is the top flag", "Search clicks" in pg.locator("#flags").text_content() and pg.locator("#flags .sev.risk").count() >= 3)
    check("chart draws six months of bars", pg.locator("#chart rect").count() == 6)
    pg.locator("#app").screenshot(path=str(TESTS / "screenshot-dashboard.png"))
    pg.click("#clients button[data-id=oakhollow]"); pg.wait_for_timeout(150)
    check("switching client recalculates everything", txt("#cName") == "Oakhollow Remodeling" and "192" in txt("#kgrid .kcard[data-k=leads]"))
    check("Oakhollow: Business Profile shown as missing, not guessed", "No data for October" in pg.locator("#srcs").text_content() and "n/a" in txt("#kgrid .kcard[data-k=mapsCalls]"))
    pg.select_option("#month", "2026-09"); pg.wait_for_timeout(150)
    check("switching month recalculates: September leads 178", "178" in txt("#kgrid .kcard[data-k=leads]") and "Connected" in pg.locator("#srcs").text_content())
    check("September: Oakhollow is ready to send", "Ready" in txt("#clients button[data-id=oakhollow]"))
    pg.select_option("#month", "2026-10")
    before = pg.locator("#flags li").count()
    pg.fill("#mom", "5"); pg.dispatch_event("#mom", "input"); pg.wait_for_timeout(150)
    check("lowering the big-swing rule flags more", pg.locator("#flags li").count() > before and txt("#momOut") == "5%")
    pg.fill("#mom", "25"); pg.dispatch_event("#mom", "input")

    print("2. AI insights and the number checker")
    pg.click("#clients button[data-id=oakhollow]"); pg.click("#tabs button[data-t=ins]"); pg.wait_for_timeout(150)
    check("draft opens with the headline sentence", txt("#draft .sent p").startswith("Leads rose 8% to 192 in October"))
    check("the checker traces every number in the AI draft", txt("#vbar").startswith("✓ All"))
    pg.click("#draft .sent >> nth=0")
    check("clicking a sentence shows where its numbers come from", pg.locator("#draft .sent.open .refs").is_visible() and "Leads change" in pg.locator("#draft .sent.open .refs").text_content())
    ed = pg.locator("#ed"); ed.fill(ed.input_value().replace("to 192", "to 210")); pg.wait_for_timeout(150)
    check("typing a wrong number (210) is flagged at once", "not found" in txt("#vbar") and "210" in pg.locator("#badnums").text_content())
    pg.locator("#p-ins").screenshot(path=str(TESTS / "screenshot-insights.png"))

    print("3. Client report is blocked until fixed")
    pg.click("#tabs button[data-t=rep]"); pg.wait_for_timeout(150)
    check("report warns about the untraced number", pg.locator("#blocked").is_visible() and "210" in txt("#blocked"))
    check("it cannot be marked ready", pg.locator("#send").is_disabled())
    pg.click("#tabs button[data-t=ins]"); pg.click("#resetEd"); pg.click("#tabs button[data-t=rep]"); pg.wait_for_timeout(150)
    check("after reset, the report can be marked ready", not pg.locator("#send").is_disabled() and not pg.locator("#blocked").is_visible())
    pg.click("#send")
    check("marking ready confirms it", "Marked ready" in txt("#sendNote"))
    check("share link is shown", txt("#share") == "https://reports.fieldline.example/r/oakhollow-remodeling-2026-10")
    pg.locator("#p-rep").screenshot(path=str(TESTS / "screenshot-report.png"))

    print("4. Video script")
    pg.click("#clients button[data-id=bluebarrow]"); pg.click("#tabs button[data-t=vid]"); pg.wait_for_timeout(150)
    check("five talking points for Bluebarrow, naming the cost per lead problem", pg.locator("#vs li").count() == 5 and "cost per ad lead went from $31.08 to $50.82" in pg.locator("#vs").text_content())

    print("5. Phone layout")
    mob = br.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    mob.on("pageerror", lambda e: problems.append(str(e)))
    mob.goto(url); mob.wait_for_function("document.querySelectorAll('#kgrid .kcard').length === 6")
    check("no sideways scrolling on a phone", mob.evaluate("document.documentElement.scrollWidth - window.innerWidth") <= 1)
    fits = mob.evaluate("Math.max(...[...document.querySelectorAll('#kgrid .kcard, .tabs, .top')].map(e => e.getBoundingClientRect().right)) <= window.innerWidth + 1")
    check("cards and tabs fit inside the phone screen (nothing clipped)", fits)
    mob.locator("#app").scroll_into_view_if_needed(); mob.screenshot(path=str(TESTS / "screenshot-mobile.png"))
    pg.screenshot(path=str(TESTS / "screenshot-full.png"), full_page=True)
    br.close()

check("no console or page errors", not problems)
if problems: print(problems[:5])
print(f"\n{passed} passed, {failed} failed")
