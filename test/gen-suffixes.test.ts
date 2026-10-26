import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTwoLabelSuffixes, renderModule } from "../scripts/gen-suffixes.ts";
import { registrableDomain } from "../src/core/domain.ts";

const psl = `// VERSION: 2099-01-01_00-00-00_UTC
// COMMIT: abc123
// ===BEGIN ICANN DOMAINS===
com
uk
co.uk
*.ck
!www.ck
// comment line
bg.uk   // trailing comment
公司.hk
com.hk
a.b.example
// ===END ICANN DOMAINS===
// ===BEGIN PRIVATE DOMAINS===
github.io
// ===END PRIVATE DOMAINS===
`;

test("only two-label ICANN suffixes are kept, as ASCII, sorted", () => {
  const list = parseTwoLabelSuffixes(psl);
  assert.deepEqual(list.suffixes, ["bg.uk", "co.uk", "com.hk", "xn--55qx5d.hk"]);
  assert.equal(list.version, "2099-01-01_00-00-00_UTC");
  assert.equal(list.commit, "abc123");
});

test("the generated module records where it came from and lists the suffixes", () => {
  const source = renderModule(parseTwoLabelSuffixes(psl));
  assert.match(source, /PSL version: 2099-01-01/);
  assert.match(source, /co\.uk/);
});

test("a list without the ICANN section is rejected", () => {
  assert.throws(() => parseTwoLabelSuffixes("com\nco.uk\n"), /ICANN/);
});

test("the committed suffix list knows the common country-code registries", () => {
  assert.equal(registrableDomain("www.bbc.co.uk"), "bbc.co.uk");
  assert.equal(registrableDomain("shop.example.com.au"), "example.com.au");
  assert.equal(registrableDomain("blog.example.co.jp"), "example.co.jp");
});
