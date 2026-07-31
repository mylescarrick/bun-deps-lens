import { valid } from "semver";

// A range we can safely rewrite: an optional comparator qualifier followed by a
// single concrete version. Compound ranges (`^1 || ^2`), hyphen ranges and
// partial versions (`^1.2`) are deliberately excluded — there is no single
// obvious rewrite for them, so we would be guessing at intent.
const SIMPLE_RANGE_RE = /^(\^|~|=|)(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?)$/;

// Rewrites `declared` to point at `latest`, keeping whatever qualifier the user
// wrote (`^`, `~`, `=`, or none). This raises the declared floor even when the
// old range would already have admitted `latest` (`^0.18.12` -> `^0.18.13`), so
// package.json states the version actually in use. Returns undefined when the
// specifier isn't a plain semver range (catalog:, workspace:, git URLs, `*`,
// `latest`), when it is too complex to rewrite unambiguously, or when it
// already names `latest`.
export function bumpRange(
  declared: string,
  latest: string
): string | undefined {
  const range = declared.trim();
  if (valid(latest) === null) {
    return;
  }

  const match = SIMPLE_RANGE_RE.exec(range);
  if (match === null) {
    return;
  }

  const qualifier = match[1] as string;
  const current = match[2] as string;
  if (current === latest) {
    return;
  }

  return `${qualifier}${latest}`;
}
