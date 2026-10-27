# AGENTS.md

## Project overview

Auto Sort Tabs is a lean browser extension for Chromium (121+) and Firefox (139+) that
automatically groups tabs into native tab groups and keeps them sorted.

- `PLAN.md` is the source of truth for architecture, acceptance criteria (AC-_n_, NF-_n_),
  milestones and decisions (§9). If the plan is wrong or ambiguous, update it and say so
  rather than silently deviating.
- `src/core/`: pure planning logic (classify → plan groups → plan order → diff).
- `src/shell/`: browser-facing code (snapshot, executor, scheduler, storage, event wiring).
- `src/background.ts`: entry point; `src/manifest.json`: single manifest for both browsers.
- `test/`: behaviour specs plus `fake-browser.ts`, an in-memory browser.
- `e2e/`: on-demand Chromium scenarios (Playwright, test-only driver extension).
- `docs/smoke-test.md`: scenarios by AC (automated and manual) for real browsers.

## Setup and build commands

```sh
npm ci                 # Node 24+
npm run build          # tsc emit + copy static files to dist/
npm run run:chrome     # build and launch Chromium with the extension
npm run run:firefox    # build and launch Firefox with the extension
npm run pack           # zip for distribution into artifacts/
npm run gen:suffixes   # refresh src/core/suffixes.generated.ts from the PSL (before releases)
```

There is no bundler: `tsc` emits ES modules that the browsers load directly. Don't add
runtime dependencies or a bundler.

## Testing instructions

Run all checks before finishing a change; CI (`.github/workflows/ci.yml`) runs the same:

```sh
npm run typecheck      # whole project + tsconfig.core.json (core purity)
npm run format:check   # Prettier; `npm run format` to fix
npm test               # node --test, runs .ts files directly
npm run lint           # build + web-ext lint
```

- `npm run test:e2e` runs the real-Chromium scenarios (`e2e/`, Playwright's bundled Chromium).
  On demand only, not in CI. One-off: `npx playwright install chromium`; needs system `openssl`.
- `npm run bench` runs the NF-3 planning benchmark (`test/*.bench.ts`). On demand only, not
  in CI: timing budgets are unreliable on shared runners.
- Run one file with `node --test test/grouping.test.ts`, or filter by name with
  `node --test --test-name-pattern "<name>" "test/**/*.test.ts"`.
- Tests describe **functional behaviour at a public boundary**: either the whole extension
  (set up a window, perform a user action, assert on the tab strip) or a public building
  block with a rich input → output contract (e.g. `registrableDomain`). Don't test private
  helpers or intermediate op lists.
- Count browser API calls only when efficiency is the requirement (AC-7, NF-4).
- `test/fake-browser.ts` is the only place browser semantics live. Mark behaviour the docs
  don't pin down as `ASSUMPTION` and add a matching check to `docs/smoke-test.md`.
- Randomised invariant tests print their seed so failures can be replayed.
- Add or update behaviour tests for every change.

## Code style

- TypeScript 7 strict. Erasable syntax only (no enums or namespaces); relative imports use
  `.ts` extensions. Formatting is Prettier's.
- **Functional core, imperative shell.** `src/core` holds plain data types and pure
  functions: no `this`, no mutation of inputs, no I/O and no `chrome`/`browser` (a type
  error under `tsconfig.core.json`). `src/shell` uses plain `async` functions; stateful
  pieces are factory functions, not classes.
- Use a `class` only for something with a real lifecycle and hidden mutable state (in
  practice, the test fake browser).
- The background worker can be stopped at any time: persistent state is plain serialisable
  data in `storage.session` / `storage.sync`, never module-level variables.
- Keep it lean: no frameworks or speculative options; the shipped zip stays under 50 KB.
- Derive data instead of hand-maintaining lists (e.g. domain suffixes come from the PSL).

## Security considerations

- Permissions are limited to `tabs`, `tabGroups` and `storage`. Don't add host
  permissions, content scripts or new permissions without updating `PLAN.md` (NF-2).
- No remote code, network requests or data collection at runtime; the only network access
  is the dev-time `gen:suffixes` script.
- User-supplied regex rules are only compiled with `RegExp`; invalid ones are skipped. Never
  evaluate user input as code.

## Commit guidelines

- [Conventional Commits](https://www.conventionalcommits.org/):
  `type(scope): imperative summary` of 72 characters or fewer. Types: `feat`, `fix`,
  `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`. Scopes: `core`, `shell`,
  `ui`; omit the scope when a change spans layers.
- Always include a body explaining what changed and why (not a file list); cite AC/NF ids
  when relevant.
- One logical change per commit, together with its tests, under ~400 changed lines
  excluding lockfiles and generated files. Split larger work into steps that each pass the
  checks above.
