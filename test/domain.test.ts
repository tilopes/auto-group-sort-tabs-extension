import assert from "node:assert/strict";
import { test } from "node:test";
import { registrableDomain } from "../src/core/domain.ts";

const cases: [hostname: string, expected: string][] = [
  ["example.com", "example.com"],
  ["www.example.com", "example.com"],
  ["a.b.c.example.com", "example.com"],
  ["example.co.uk", "example.co.uk"],
  ["www.example.co.uk", "example.co.uk"],
  ["a.b.example.com.br", "example.com.br"],
  ["bbc.co.uk", "bbc.co.uk"],
  ["xn--nxasmq6b.xn--j6w193g", "xn--nxasmq6b.xn--j6w193g"],
  ["www.xn--nxasmq6b.com.hk", "xn--nxasmq6b.com.hk"],
  ["co.uk", "co.uk"],
  ["localhost", "localhost"],
  ["example.com.au", "example.com.au"],
  ["docs.google.com", "google.com"],
  ["user.github.io", "github.io"],
];

for (const [hostname, expected] of cases) {
  test(`${hostname} belongs to the registrable domain ${expected}`, () => {
    assert.equal(registrableDomain(hostname), expected);
  });
}
