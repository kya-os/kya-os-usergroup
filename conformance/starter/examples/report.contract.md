# The report contract (`report.json`)

This is the exact JSON a harness must emit for `npm run claim` to accept it.
It is exactly what the published TypeScript runner (`conformance/runner.ts` in decentralized-identity/kya-os-mcp, fetched to `suite/runner.ts`) emits as its `ConformanceReport`.
A bring-your-own-harness in any language must match it field for field; `scripts/make-claim.mjs` enforces every rule below and refuses anything else.

## Top level (`ConformanceReport`)

| field | type | rule |
| --- | --- | --- |
| `adapter` | string | Your implementation's name, non-empty. |
| `total` | number | MUST equal `results.length`. |
| `passed` | number | MUST equal the count of results with `ok: true`. |
| `failed` | number | MUST equal `total - passed`. |
| `results` | array | One `VectorRunResult` per executed vector, non-empty. |
| `allMatched` | boolean | MUST equal `failed === 0`. |

## Per vector (`VectorRunResult`)

| field | type | rule |
| --- | --- | --- |
| `id` | string | The vector's `id`, unique across the report (e.g. `signed-proof/valid-basic`). |
| `category` | string | The vector's category (one of the nine suite categories). |
| `description` | string | The vector's `description`, copied through. |
| `expected` | `"pass"` \| `"fail"` | The vector's `expected` outcome, copied through. |
| `actual` | `"pass"` \| `"fail"` \| `"error"` | What your implementation did: `pass` = accepted the artifact, `fail` = rejected it, `error` = your harness threw. |
| `ok` | boolean | MUST equal `actual === expected`. |
| `detail` | string, optional | Free-form reason, especially useful on rejection or error. |

## Semantics you must preserve

- A vector with `expected: "fail"` (a tampered proof, broken chain, revoked credential, malformed DID) passes the suite only when your implementation REJECTS it, i.e. `actual: "fail"`, `ok: true`.
- `actual: "error"` (your verifier threw instead of returning a verdict) always counts as a mismatch, even against `expected: "fail"`.
  Conformant verifiers are fail-closed: they reject, they do not crash.
- `ok` is the per-vector match field.
  There is no per-vector field named `pass`; the pass/fail vocabulary belongs to `expected`/`actual`.

## Example (abridged)

```json
{
  "adapter": "acme-kya (rust)",
  "total": 44,
  "passed": 44,
  "failed": 0,
  "results": [
    {
      "id": "signed-proof/valid-basic",
      "category": "signed-proof",
      "description": "well-formed detached proof with valid signature",
      "expected": "pass",
      "actual": "pass",
      "ok": true
    },
    {
      "id": "signed-proof/tampered-payload",
      "category": "signed-proof",
      "description": "payload mutated after signing",
      "expected": "fail",
      "actual": "fail",
      "ok": true,
      "detail": "signature verification failed"
    }
  ],
  "allMatched": true
}
```

The vector inputs your harness reads live in `suite/vectors/*.json` after `npm run fetch-suite`; each file is `{ version, category, vectors: [{ id, category?, description, expected, reason, input }] }`, and a vector missing `category` inherits the file's.
