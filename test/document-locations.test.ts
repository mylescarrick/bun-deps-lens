import { describe, expect, test } from "bun:test";
import { DependencyLocationsCache } from "../src/document-locations";

describe("DependencyLocationsCache", () => {
  test("shares a parse across callers and updates on unsaved document versions", () => {
    const cache = new DependencyLocationsCache();
    let text = '{"dependencies":{"foo":"1.0.0"}}';
    let reads = 0;
    const document = {
      getText: () => {
        reads += 1;
        return text;
      },
      uri: { toString: () => "file:///project/package.json" },
      version: 1,
    };
    const first = cache.get(document);
    expect(first[0]?.declaredRange).toBe("1.0.0");
    expect(cache.get({ ...document })).toBe(first);
    expect(reads).toBe(1);

    text = '{"dependencies":{"foo":"2.0.0"}}';
    document.version = 2;
    expect(cache.get(document)[0]?.declaredRange).toBe("2.0.0");
    expect(reads).toBe(2);
  });
});

test("document cache eviction permits a reopened buffer to restart at version one", () => {
  const cache = new DependencyLocationsCache();
  const uri = { toString: () => "file:///project/package.json" };
  cache.get({
    getText: () => '{"dependencies":{"foo":"1.0.0"}}',
    uri,
    version: 1,
  });
  cache.delete(uri.toString());
  expect(
    cache.get({
      getText: () => '{"dependencies":{"bar":"2.0.0"}}',
      uri,
      version: 1,
    })[0]?.name
  ).toBe("bar");
  cache.clear();
  expect(
    cache.get({
      getText: () => '{"dependencies":{"baz":"3.0.0"}}',
      uri,
      version: 1,
    })[0]?.name
  ).toBe("baz");
});
