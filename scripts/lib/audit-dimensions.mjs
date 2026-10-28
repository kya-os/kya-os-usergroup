// The seven dimensions of a KYA-OS audit verification report, in report
// order, with the wording the /verify/ page uses for each, plus the CLI's
// exit-code rule. Shared verbatim by the build (site/lib/verify.mjs renders
// the "what the report means" list) and the browser (/ui/verify.js labels
// the live result), so the two can never describe a dimension differently.
// Browser-safe: no imports at all (the build copies this file byte for byte
// to /ui/audit-dimensions.js). Definitions follow AUDITABILITY.md in the
// reference repository ("The report keeps these dimensions separate").

export const AUDIT_DIMENSIONS = [
  {
    key: "cryptographicIntegrity",
    name: "Signatures and digests",
    means: "Every entry, receipt, checkpoint and the bundle itself is signed by a key the policy trusts, and every digest matches the content it covers.",
  },
  {
    key: "chainIntegrity",
    name: "Hash chain",
    means: "Each entry commits to the digest of the one before it, so no entry was dropped or inserted within the range.",
  },
  {
    key: "checkpointIntegrity",
    name: "Checkpoints",
    means: "The signed Merkle checkpoints (RFC 9162) match the entries they cover, and every covered entry carries a valid inclusion proof.",
  },
  {
    key: "anchorIntegrity",
    name: "Witnesses and anchors",
    means: "Observations of the checkpoints by independent witnesses, and any external anchors, verify against the observers the policy trusts.",
  },
  {
    key: "scopeEvidenceCompleteness",
    name: "Completeness",
    means: "The bundle holds everything its signed manifest commits to, for the whole ledger range it claims to cover.",
  },
  {
    key: "authorizedAsObserved",
    name: "Authorization at the time",
    means: "Each action was authorized when it happened. This needs authorization evidence in the bundle and a verifier for it.",
  },
  {
    key: "currentAuthorization",
    name: "Authorization now",
    means: "That authority still holds today. This needs live status, so a check from files alone leaves it indeterminate.",
  },
];

export const VERDICTS = {
  valid: "the evidence is present and checks out",
  invalid: "the evidence is present and fails",
  indeterminate: "the evidence needed to decide is not there; never counted as valid",
};

/** The kya-audit exit code for a report: 1 when any dimension is invalid, else 0 (2 is reserved for unreadable input). */
export function auditExitCode(report) {
  return Object.values(report).some((value) => value !== null && typeof value === "object" && value.verdict === "invalid") ? 1 : 0;
}
