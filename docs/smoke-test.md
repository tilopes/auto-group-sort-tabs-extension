# Manual smoke test (M2)

What the automated tests cannot prove: the extension against real Chrome and Firefox. Run it
before starting M3. Record results next to each step; anything marked **RECORD** that differs
from the expectation invalidates an `ASSUMPTION` in `test/fake-browser.ts` (and the tests built
on it), so report it.

There is no UI yet (M4). Automatic grouping is on, auto-sort is off, `minTabs` is 3, and
"Organize now" is not reachable. Use the steps below, and the service worker console for raw API
calls.

## 1. Build and load

```sh
npm ci
npm run build        # emits dist/
```

**Chrome / Edge / Brave (121+):** open `chrome://extensions`, enable _Developer mode_,
_Load unpacked_, choose `dist/`. Open the console with the _service worker_ link on the
extension card.

**Firefox 139+:** open `about:debugging#/runtime/this-firefox`, _Load Temporary Add-on…_, choose
`dist/manifest.json`. Open the console with _Inspect_. (Temporary add-ons are removed when
Firefox closes; step 14 needs a profile that keeps it, see there.)

Console helper used below (paste into the background console; use `browser` instead of `chrome`
in Firefox, or `const api = globalThis.browser ?? globalThis.chrome`):

```js
const api = globalThis.browser ?? globalThis.chrome;
const dump = async () =>
  (await api.tabs.query({ currentWindow: true })).map(
    (t) => `${t.index} id=${t.id} g=${t.groupId} ${t.pinned ? "P " : ""}${t.url}`,
  );
```

## 2. Loads and runs

1. After loading, the console shows no errors and the extension card shows no errors.
   Expected: ES-module background starts in both browsers (Chrome uses `service_worker`,
   Firefox uses `scripts`). **RECORD** any error text.

## 3. Auto-group at the third tab (AC-1)

Use a window with a few unrelated tabs (e.g. `example.org`, `example.net`).

2. Open `https://github.com/a` then `https://github.com/b`. Expected: both stay ungrouped.
3. Open `https://github.com/c`. Expected: within ~2 s a group titled `github.com` containing
   the three tabs appears; the tab you are looking at (the active one) may stay out until you
   switch away from it, then it joins.
4. Open `https://github.com/d`. Expected: it joins the existing group.

## 4. Dragged-out tab stays out (AC-6)

5. Drag `github.com/c` out of the group to the end of the strip. Expected: it stays out.
6. Open `https://github.com/e`. Expected: it joins the group; `c` stays out.
7. Navigate `c` to another `github.com` page (e.g. `github.com/c/issues`). Expected: stays out.
8. **Idle case.** Close the service-worker/Inspect DevTools window (it keeps the worker alive).
   Wait more than 30 s (Chrome: `chrome://serviceworker-internals` or the extensions page shows
   the worker as inactive; Firefox: about:debugging shows the background script stopped, if it
   offers it). Then navigate `c` to another `github.com` page. Expected: stays out.
9. Navigate `c` to `https://gitlab.com`. Expected: not grouped (only one tab for that
   domain), and it does not rejoin the `github.com` group.

## 5. User's own things are left alone

10. Pin a tab (`example.org`), then open three `github.com` tabs. Expected: the pinned tab
    never moves or joins a group; the new group appears after it.
11. Make your own group by hand (right-click a tab → _Add to new group_, name it `Mine`,
    containing `example.net` tabs). Expected: it is never renamed, moved or merged, even after
    more tabs open.
12. Rename the `github.com` group to `Work`, then open another `github.com` tab. Expected: the
    renamed group is left alone and the new tab is not added to it.

## 6. Active tab deferral

13. Open `github.com/x`, `github.com/y` and, as the active tab, `github.com/z` quickly (link
    "open in new tab" with focus on the last). Expected: a group forms for the first two; the
    active `z` is not moved or grouped while you are on it. Switch to another tab; `z` joins
    the group within ~2 s.

## 7. Startup pass

Set up: a window with `github.com/{a,b,c}` ungrouped plus an unrelated active tab.

14. **Chrome:** set _On startup → Continue where you left off_, quit the browser completely and
    reopen it. **Firefox:** use `npx web-ext run --source-dir dist` with `--keep-profile-changes`
    (or a signed build) and a session-restore setting, restart. Expected: within ~12 s the
    github tabs are grouped (the active tab joins after you switch away); no sorting happens
    (auto-sort is off). Restored windows are handled too, not only the first.
15. Open a new window long after startup (more than 10 s). Expected: its tabs are not
    reorganised.
16. Reload the extension from `chrome://extensions` (or `about:debugging`). Expected: no
    reshuffling (a reload is not an install).

## 8. Fake-browser ASSUMPTIONs

Run these in the background console, in a fresh window with the extension still loaded.
Use unrelated domains (e.g. `a1.test`, `a2.test`, …, each opened once or twice) so the
extension does not group them itself. Tabs below are by index in the window. After each step
run `await dump()` and **RECORD** the output.

Setup: open 6 unrelated tabs `t0…t5`, then `const ids = (await api.tabs.query({currentWindow:true})).map(t=>t.id)`.

17. **New-group placement.** `await api.tabs.group({tabIds:[ids[1], ids[3]]})`.
    Assumed: the group appears at index 1 (where its leftmost tab was), members adjacent
    (`ids[1]`, `ids[3]`), and the other tabs keep their relative order. **RECORD** the full
    order if different (e.g. group created at the end, or at index 3).
18. **Drop into a group.** With a group of `[x, y]`, move an ungrouped tab between them:
    `await api.tabs.move(z, {index: <index of y>})`. Assumed: `z` joins the group
    (`groupId` equals theirs). Repeat by _dragging_ with the mouse. **RECORD** whether
    `tabs.move` and a manual drag differ, and the resulting `groupId`.
19. **Drop out of a group.** Move a grouped tab to the end: `await api.tabs.move(x,
{index: -1})`. Assumed: it leaves the group (`groupId` -1). **RECORD** if it stays in the
    group (the strip is then inconsistent) or the browser refuses.
20. **Ungroup from the middle.** With group `[a, b, c]`, `await api.tabs.ungroup(b)`.
    Assumed: `b` lands right after the group (`a, c, b`), ungrouped. **RECORD** if it stays
    in place (the group is split) or goes elsewhere.
21. **Pinned boundary, array `tabs.move` (Firefox 139 especially).** Pin one tab. Then
    `await api.tabs.move([idOfUnpinned], {index: 0})`. Assumed: Chrome rejects or clamps,
    Firefox resolves `[]` (the executor treats that as failure and retries). Also
    `await api.tabs.move([idA, idB], {index: 3})` for two unpinned tabs. Assumed: both
    move, result is an array of 2 tabs. **RECORD** the return value and resulting order
    for each, and whether the promise rejected.
22. **Group move.** `await api.tabGroups.move(groupId, {index: 0})` with a pinned tab present.
    Assumed: refused/throws before pinned tabs. `{index: -1}` moves it to the end.
    **RECORD** results.
23. **Group create + title in Firefox 139.** `const g = await api.tabs.group({tabIds:[a,b,c],
createProperties:{windowId}})` then `await api.tabGroups.update(g, {title:"T", color:"blue"})`.
    Expected: both succeed; the group shows title and colour. **RECORD** any error.
