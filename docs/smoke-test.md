# Testing against real browsers

Behaviour is specified by the fake-browser specs (`npm test`). This file covers the real
browsers: what `npm run test:e2e` automates in Chromium, and what only a person can check.
Anything marked **RECORD** that differs from the expectation invalidates an `ASSUMPTION` in
`test/fake-browser.ts` (and the tests built on it), so report it.

Defaults: automatic grouping on, auto-sort off, `minTabs` 3. The toggles are in the popup, the
rest in the options page (scenarios 25–32). "Organize now" is the popup button or the shortcut
Alt+Shift+O (Option+Shift+O on macOS); rebind it at `chrome://extensions/shortcuts`, or in Firefox
_Add-ons → ⚙ → Manage Extension Shortcuts_. In Firefox the toolbar button lives in the Extensions
(puzzle) menu until pinned. Scenarios below that say "turn auto-sort on" mean the popup toggle.

## Automated: `npm run test:e2e` (Chromium)

Runs the AC-1…AC-10 scenarios (except the real clicks and keys) below in Playwright's bundled Chromium with the built extension
loaded. It is on demand, not part of `npm test` or per-commit CI (PLAN §8).

- One-off setup: `npx playwright install chromium`; the system `openssl` is needed too (the
  fixture proxy makes a throwaway certificate). `E2E_HEADED=1` shows the browser.
- Branded Chrome 137+ ignores `--load-extension`, hence the bundled Chromium.
- No network: a local proxy answers every request (title = the URL), so the real URLs below
  work offline. Playwright's `context.route` does not see main-frame loads of tabs created
  through the API, hence the proxy.
- A test-only driver extension (`e2e/driver-extension/`, not shipped) performs user actions
  through `tabs`/`tabGroups`; the extension under test only sees events. Assertions read the
  real tab strip.
- The popup and options pages are opened as extension pages (`chrome-extension://<id>/ui/…`) in a
  tab of the window under test and driven through the DOM; the popup's Organize now sends the same
  message as in the real popup. A real toolbar click, and the popup's own window, are manual.
- Not covered (manual, below): real mouse drags, restart/session restore, Firefox, Edge/Brave.

## Build and load (manual runs)

```sh
npm ci
npm run build        # emits dist/
```

**Chrome / Edge / Brave (121+):** `chrome://extensions` → _Developer mode_ → _Load unpacked_ →
`dist/`. Open the console with the _service worker_ link on the extension card.

**Firefox 139+:** `about:debugging#/runtime/this-firefox` → _Load Temporary Add-on…_ →
`dist/manifest.json`. Open the console with _Inspect_. (Temporary add-ons vanish when Firefox
closes; for M-6 use `npx web-ext run --source-dir dist --keep-profile-changes`.)

Console helper (background console; Firefox also has `browser`):

```js
const api = globalThis.browser ?? globalThis.chrome;
const dump = async () =>
  (await api.tabs.query({ currentWindow: true })).map(
    (t) => `${t.index} id=${t.id} g=${t.groupId} ${t.pinned ? "P " : ""}${t.url}`,
  );
```

## Scenarios by acceptance criterion

Start each in a fresh window. "Group X" means a group titled X. Wait ~2 s between steps.
Tests are named `AC-n: …` in `e2e/`.

**AC-1 Auto-group at three tabs** (automated)

1. Open `https://github.com/microsoft/TypeScript`, `https://gist.github.com/`,
   `https://github.com/nodejs/node` → one group `github.com` within 1 s.
2. `https://www.bbc.co.uk/news`, `/sport`, `/weather` → group `bbc.co.uk`.
3. `http://localhost:3000/a`, `/b`, `/c` → group `localhost:3000`; two `http://localhost:4000/`
   tabs stay ungrouped.
4. `https://en.wikipedia.org/wiki/Tab_key` + `https://de.wikipedia.org/wiki/Tabulator` → no
   group (only two).

**AC-2 Rules beat the domain default** (automated)

5. Set the rule (service-worker console, or `storage.sync.set` in the driver):
   `{settings:{rules:[{name:"Docs",color:"blue",enabled:true,match:{type:"regex",pattern:"^https://(developer\\.mozilla\\.org|developer\\.chrome\\.com|docs\\.github\\.com)/"}}]}}`.
   Open `https://developer.mozilla.org/en-US/docs/Web/API`,
   `https://developer.chrome.com/docs/extensions`, `https://docs.github.com/en`, then
   `https://github.com/a`, `/b`, `/c` → blue group `Docs` with the three doc tabs (docs.github.com
   included), group `github.com` with a, b, c.

**AC-3 Membership follows the URL; groups dissolve at one tab** (automated; 9a and 9b need a real mouse)

6. Groups `github.com` (TypeScript, node, prettier) and `bbc.co.uk` (three tabs). Navigate a
   github tab to `https://www.bbc.co.uk/food` → it joins `bbc.co.uk`; `github.com` keeps two.
7. Navigate another to `https://example.com/` → `github.com` dissolves.
8. Close two `bbc.co.uk` tabs while another tab is active → the group dissolves.
9. Same, but the last remaining tab is active → the group stays until you switch away, then it
   dissolves.
   9a. **Manual (real mouse):** a three-tab group; drag one tab out of it onto the strip, then a
   second one → the group dissolves right after the second drag, without opening or closing
   any tab, and the dragged tabs stay ungrouped. Also right-click → _Remove from group_ on the
   tabs. (e2e does the same with `tabs.ungroup`.)
   9b. **Manual:** drag a tab of one group into another group, until the first is left with one
   tab → the first dissolves. Repeat with the last remaining tab being the active one: it stays
   until you switch to another tab, then dissolves (switching tabs is enough, no new tab needed).
   **RECORD** if a one-tab group survives past ~1 s.

**AC-4 Pinned tabs** (automated)

10. Pin `https://github.com/notifications`, then open three `github.com` tabs → pinned tab stays
    first, then ungrouped tabs, then the new group; the pinned tab never joins a group.

**AC-5 User groups are left alone** (automated; create `Mine` by hand: right-click → _Add to
new group_)

11. `Mine` with two `github.com` tabs. Open three more `github.com` tabs; navigate a `Mine` tab
    to `https://www.bbc.co.uk/news` → `Mine` keeps its title, order and position; the new tabs
    form a separate `github.com` group.
12. Rename an auto-created group to `Work`, open another `github.com` tab → the renamed group is
    left alone and the tab is not added.

**AC-6 Manual moves are respected**

13. (automated, API move) Drag a tab out of `github.com`, open `https://github.com/rust-lang/rust`,
    navigate the moved-out tab to `https://github.com/golang/go` → it stays out.
14. (automated, worker stopped over CDP) Repeat 13 after stopping the extension's service
    worker. **Manual idle variant:** close the worker's DevTools, wait more than 30 s (the
    extension card / `about:debugging` shows the worker inactive), then navigate within the
    domain → stays out.
15. (automated) Navigate it to `https://www.bbc.co.uk/news` → joins `bbc.co.uk`.
16. (automated, API move) Move a `github.com` tab into `bbc.co.uk` → it stays there.
17. **Manual: do 13, 15 and 16 with the mouse** (drag out/in). **RECORD** if the result differs
    from the API-driven one (see the ASSUMPTIONs below).

**AC-7 Organize now** (automated; Playwright cannot press browser chrome, so the tests dispatch
`action.onClicked` / `commands.onCommand` to the extension. Pressing the real keys and button is manual)

18. Open, in this order, in a window whose first tab is `https://example.org/`:
    `https://www.rust-lang.org/`, `https://en.wikipedia.org/wiki/Tab_key`,
    `https://github.com/nodejs/node`, `https://www.bbc.co.uk/news`,
    `https://de.wikipedia.org/wiki/Tabulator`, `https://github.com/microsoft/TypeScript`,
    `https://example.com/`, `https://www.bbc.co.uk/sport`,
    `https://fr.wikipedia.org/wiki/Tabulation`, `https://github.com/prettier/prettier`,
    `https://www.bbc.co.uk/weather`. Three groups form in arrival order; nothing is sorted. Click
    the popup's Organize now → `bbc.co.uk` (news, sport, weather), `github.com` (TypeScript, node,
    prettier), `wikipedia.org` (de, en, fr), then `example.com`, `example.org`, `rust-lang.org`.
    The active tab is moved too. (The e2e fixture's page titles are the URLs. Real pages have
    other titles, so the order inside a group follows those.)
19. Click Organize now again → nothing moves. (e2e counts `tabs.move/group/ungroup` and `tabGroups.move/update`
    calls: none.)
20. Scramble the window and press the shortcut instead → same result as 18. **Manual:** do 18
    with the real popup button (it acts on the window the popup belongs to; in Firefox check this
    with two windows) and with the real shortcut, in Chrome and Firefox. **RECORD** if
    the shortcut does nothing (taken by another extension or the OS, or not assigned: the e2e
    only checks that Chromium registered it), and how the browser displays it.

**AC-8 Active tab deferral** (automated; 22 and 23 need auto-sort on)

21. Two `github.com` tabs plus the first tab of the window. With the first tab active, navigate it
    to `https://github.com/vercel/next.js` → it is not moved while active; it joins the group
    after you switch away.
22. With auto-sort on, open `https://www.rust-lang.org/` then `https://example.com/` → each lands
    in domain order: `example.com`, `example.org`, `rust-lang.org`.
23. With auto-sort on, open `https://github.com/microsoft/TypeScript`,
    `https://github.com/prettier/prettier`, `https://github.com/webpack/webpack` → a sorted
    `github.com` group appears in front of the ungrouped tab. Open `https://github.com/nodejs/node`
    as the active tab → it stays at the end while active; after switching to `example.org` it
    joins the group between TypeScript and prettier.

**AC-9 Non-groupable pages** (automated; opened through the API, they open fine)

24. Three each of `about:blank`, `chrome://settings`, `chrome://newtab`, `file:///etc/hosts`
    (Firefox: `about:blank`, `about:preferences`, `about:newtab`) → all ungrouped.

**AC-10 Settings and UI** (25–30 automated in Chromium as extension pages; 31–32 manual)

Open the options page from the popup's _Settings_ button, or from `chrome://extensions` →
Details → Extension options (Firefox: _about:addons_ → the extension → Preferences; it opens in
a tab).

25. Popup: the two switches show the stored state (auto-group on, auto-sort off by default).
    Both pages follow the system light/dark setting and look consistent (same font, controls).
    Switching auto-sort on and opening three out-of-order `github.com` tabs sorts them; turning
    auto-group off stops new groups. Turning auto-group on does nothing by itself: the next tab
    event or Organize now applies it.
26. Options: _Add rule_ → _Docs_, host, `docs.github.com`. There is no Save button: after a
    moment the header shows _Saved_ (switches and selects save at once). Open `https://docs.github.com/a`,
    `/b`, `/c` → one group "Docs". Changes need no restart.
27. Options: set the strategy to hostname and `minTabs` to 2 → two tabs of `https://en.wikipedia.org/`
    form a group named `en.wikipedia.org`; `minTabs` outside 2–20 shows an error under the field
    and is not saved.
28. Options: add a regex rule `^https://(` → the error "Invalid regular expression…" shows next to
    the rule once you leave the row and it is not saved (reload: the rule is gone). Fix the
    pattern → it saves by itself.
29. Rules: move a rule up/down (first match wins), disable it, remove it; each takes effect on the
    next run.
30. Export → copy the JSON, remove all rules, Import the JSON → the rules are back. Importing
    text that is not JSON, or has `"version": 2`, changes nothing and says why; rules with an
    invalid pattern are skipped and counted.
31. **Manual:** with the browser in Chrome signed in to sync (or Firefox Sync with add-ons
    enabled), change a rule on one device → it appears on another (`storage.sync`). **RECORD**
    if not.
32. **Manual:** import 120 rules (e.g. a script-generated JSON) → "Not imported: …quota…" (Chrome:
    `QUOTA_BYTES_PER_ITEM`; Firefox: its own wording). **RECORD** the Firefox text. Restart the
    browser → options and toggles are as saved (automated for Chromium).

## Manual only

**M-1 Loads and runs.** After loading, the console and the extension card show no errors; the
ES-module background starts in both browsers (Chrome uses `service_worker`, Firefox `scripts`).
**RECORD** any error text.

**M-2 Firefox.** Run scenarios 1–30 by hand. Also: `tabs.group` + `tabGroups.update(g, {title:
"T", color:"blue"})` succeed and show title and colour; `tabGroups.move(g, {index: 0})` with a
pinned tab present is refused, `{index: -1}` moves it to the end. **RECORD** errors.

**M-3 Edge and Brave.** Run scenarios 1–9 and 18–20 once each.

**M-4 Startup pass.** Window with `github.com/{a,b,c}` ungrouped plus an unrelated active tab.
Chrome: _On startup → Continue where you left off_, quit fully, reopen. Expected: within ~12 s
the github tabs are grouped (the active one joins after you switch away); nothing is sorted;
restored windows are handled too.

**M-5 Not an install.** A new window opened more than 10 s after startup is not reorganised, and
reloading the extension does not reshuffle.

**M-6 Persistence.** In Firefox, repeat 14 (idle variant) with a kept profile.

## Fake-browser ASSUMPTIONs still unverified

Verified in real Chromium by the e2e suite (the fake was corrected where it differed):
new-group placement (consistent with the group appearing at its leftmost member's position), where a tab added to a group lands (before the
first member when it comes from the left, otherwise after the last), and ungroup placement (towards
the nearer end of the group, ties after it).

Still open; run in the background console in a fresh window of unrelated domains (`a1.test`,
`a2.test`, …), `await dump()` after each, and **RECORD** the output:

33. **Drop into a group (mouse).** Group of `[x, y]`; drag an ungrouped tab between them. Assumed:
    it joins (`groupId` equals theirs). **RECORD** the resulting `groupId` and whether it differs
    from `await api.tabs.move(z, {index: <index of y>})`.
34. **Drop out of a group (mouse).** Drag a grouped tab to the end of the strip. Assumed: it
    leaves the group (`groupId` -1). **RECORD** if it stays or the browser refuses.
35. **Firefox array `tabs.move` at the pinned boundary.** Pin one tab, then
    `await api.tabs.move([idOfUnpinned], {index: 0})`. Assumed: Chrome rejects or clamps, Firefox
    resolves `[]` (the executor treats that as failure). Also `await api.tabs.move([idA, idB],
{index: 3})` for two unpinned tabs: both move, result has two tabs. **RECORD** the return value,
    order and whether it rejected.
