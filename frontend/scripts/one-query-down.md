# Sweeping with one query down at a time (M213)

The sweep that found the fourth and fifth instances of *"one page, several
queries, only one of them guarded"*. **It was scripted, not driven by hand —
but it lived in a browser console and died with the tab**, which is its own
small version of the problem it was built to solve: a result nobody else can
reproduce is close to a result nobody can check.

So it lives here. Paste it into the console with `/dev/pages` open.

```js
window.__sweep = async (pages) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Only endpoints THIS browser's session can actually read. Forcing one
  // that already 401s proves nothing about a mixture, and counting those
  // pairs would be counting them clean.
  const ENDPOINTS = ["/channels", "/people", "/settings", "/screen-state"];
  const SUSPECT =
    /\b0 (channels|photographs|contributors|memories|cards|missions)|\b0 of 0|no card yet|Nothing (added|waiting|has happened)|No (contributors|channels|guides|profile|NFC)|None this week/i;

  const out = [];
  for (const p of pages) {
    for (const e of ENDPOINTS) {
      history.pushState({}, "", `/dev/pages/${p}?mode=ready&role=admin&fail=${e}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
      await wait(520);
      const body = document.body.innerText.replace(/\s+/g, " ");
      // The banner says so when a page never calls the forced endpoint —
      // that pair is not coverage and must not be counted as clean.
      if (body.includes("never called")) continue;
      const f = document.querySelector('[style*="dashed"]');
      if (!f) continue;
      const t = f.innerText.replace(/\s+/g, " ");
      const h = t.match(SUSPECT);
      if (h) out.push(`${p || "(overview)"} + fail=${e} → "${h[0]}" :: ${t.slice(0, 90)}`);
    }
  }
  return out.length ? out.join("\n") : `clean across ${pages.length * ENDPOINTS.length} pairs`;
};
```

Then, in batches of four or five pages (more than that and the tool call
times out):

```js
window.__sweep(["", "shelf", "contributors", "cards"]);
window.__sweep(["missions", "activity", "margaret", "my-info", "insights", "channels/deleted"]);
```

## Reading the output

**Every hit is a candidate, not a finding.** The last run was **40 pairs, 6
raw matches, 2 real, 4 rejected** — one was a channel that genuinely has no
photographs in it, and two were endpoints that fail for this session whatever
the switch does, so they say nothing about a *mixture*. A sweep that reports
its raw regex hits is a sweep nobody has read.

**Report the denominator and the rejections**, not just the finds.

## What it cannot see

- **Endpoints this session cannot read** — `/nfc-cards`, `/streams/*`,
  `/missions` all 401 without a family session, so they are excluded rather
  than counted. Their pages can be witnessed only in the failing direction.
  `?empty=<list>` covers the other direction for **list** endpoints; an
  object endpoint is refused by name rather than invented.
- **Anything below the regex.** It matches figures and stock empty
  sentences. "The screen has not been on this week" has no absence words in
  it and would not match — M197 settled that the prose half of this class is
  not reachable by pattern.
