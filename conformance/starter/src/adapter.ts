/**
 * YOUR ConformanceAdapter.
 *
 * This is the single seam between the pinned KYA-OS conformance suite and your
 * implementation. Each method receives one vector's `input` and answers whether
 * YOUR implementation ACCEPTED (`{ outcome: 'pass' }`) or REJECTED
 * (`{ outcome: 'fail', detail }`) the artifact. The runner compares that answer
 * to the vector's `expected`, so a tampered-proof vector passes the suite only
 * when you correctly reject it.
 *
 * CONTRACT (suite/types.ts): once implemented, methods MUST be fail-closed.
 * Any error, malformed input, or unmet security property returns
 * `{ outcome: 'fail' }`; implemented methods MUST NOT throw. The stubs below
 * deliberately violate that by throwing NotImplementedError, so an
 * unimplemented adapter shows up loudly as `actual: "error"` mismatches in the
 * report instead of silently passing anything.
 *
 * Each TODO cites what the reference adapter (conformance/reference-adapter.ts
 * in decentralized-identity/kya-os-mcp at the pinned ref) does with the same
 * input, as the behavioral yardstick. Wire your OWN primitives; do not port the
 * reference logic.
 */

import type {
  AdapterResult,
  AuditIntegrityInput,
  CardProofInput,
  ConformanceAdapter,
  DelegationChainInput,
  DidResolutionInput,
  EntityCardInput,
  NegotiationInput,
  SignedProofInput,
  StatusListInput,
} from '../suite/types.js';

/** Thrown by unimplemented stubs. Delete every use of this as you implement. */
class NotImplementedError extends Error {
  constructor(method: string) {
    super(
      `${method} is not implemented yet. Wire it to your implementation and return ` +
        `{ outcome: 'pass' | 'fail' } fail-closed instead of throwing.`,
    );
    this.name = 'NotImplementedError';
  }
}

export class StarterAdapter implements ConformanceAdapter {
  /** Surfaced in the report; set it to your implementation's name. */
  readonly name = 'my-implementation (starter)';

  /**
   * TODO: verify a signed detached proof.
   * Reference: builds a ProofVerifier with a clock pinned to `input.now * 1000`
   * and skew `input.skewSeconds`, then verifies `input.proof` (a `{ jws, meta }`
   * DetachedProof) against `input.publicKeyJwk` - signature, nonce, and
   * timestamp-skew checks together decide accept/reject.
   */
  async verifySignedProof(input: SignedProofInput): Promise<AdapterResult> {
    throw new NotImplementedError('verifySignedProof');
  }

  /**
   * TODO: verify a DelegationCredential and its full chain to the root.
   * Reference: resolves DIDs only from `input.didDocuments` (offline), verifies
   * each credential's signature, and validates the chain (issuer/subject
   * continuity, audience must include `input.serverDid`), supplying
   * `input.ancestors` root-to-parent when the leaf is a re-delegation.
   * Status checking is deliberately out of scope here (see verifyStatusList).
   */
  async verifyDelegationChain(input: DelegationChainInput): Promise<AdapterResult> {
    throw new NotImplementedError('verifyDelegationChain');
  }

  /**
   * TODO: verify a credential's StatusList2021 revocation status.
   * Reference: looks up the signed StatusList2021Credential from
   * `input.statusLists` by the credentialStatus's `statusListCredential` id,
   * decodes the encoded bitstring, checks the bit at `statusListIndex`, and
   * verifies the credential itself (signature via `input.didDocuments`).
   * A set bit means revoked, which means reject.
   */
  async verifyStatusList(input: StatusListInput): Promise<AdapterResult> {
    throw new NotImplementedError('verifyStatusList');
  }

  /**
   * TODO: resolve a did:key DID offline.
   * Reference: resolves `input.did` with its did:key resolver and passes only
   * when the resulting DID document carries a usable Ed25519 verification
   * method; malformed multicodec/base58 DIDs must reject.
   */
  async resolveDidKey(input: DidResolutionInput): Promise<AdapterResult> {
    throw new NotImplementedError('resolveDidKey');
  }

  /**
   * TODO: resolve a did:web DID.
   * Reference: serves `input.didDocument` at the DID's well-known URL through a
   * static fetch stub (no live network) and passes only when resolution yields
   * a usable Ed25519 verification method; a missing document (404) must reject.
   */
  async resolveDidWeb(input: DidResolutionInput): Promise<AdapterResult> {
    throw new NotImplementedError('resolveDidWeb');
  }

  /**
   * TODO: verify a stateless `org.kya-os/proof.v1` holder-of-key proof.
   * Reference: recomputes the detached JWS signature against `input.jwks`
   * (key by `kid`, plus DID-key membership for the proof's `did`), the RFC 8785
   * `requestHash` over `input.request`, `audience === input.expectedAudience`,
   * nonce freshness through a single-use consume seam, and the created/expires
   * window at `input.nowMs` with `input.skewSeconds`; honors `tokenCnfJkt` when
   * present. When `input.omitNonceSeam` is true it runs WITHOUT a nonce seam
   * and must fail closed rather than skip replay protection.
   */
  async verifyCardProof(input: CardProofInput): Promise<AdapterResult> {
    throw new NotImplementedError('verifyCardProof');
  }

  /**
   * TODO: parse and verify a typed, DID-anchored Entity Card.
   * Reference: parses `input.card` fail-closed (a malformed card rejects
   * immediately), then verifies it with `input.trustedIssuers`,
   * `input.cimdKeyProven`, and, when `input.accountability` is present, an
   * accountability verifier that recomputes the delegation chain
   * (resourceOwner/resource/proofDid join) at the pinned `now`.
   */
  async verifyEntityCard(input: EntityCardInput): Promise<AdapterResult> {
    throw new NotImplementedError('verifyEntityCard');
  }

  /**
   * TODO: verify RFC 9162 audit integrity material.
   * Reference: checks that `input.event` canonicalizes (RFC 8785) to
   * `input.eventCanonical` and digests to `input.eventDigest`, reproduces the
   * optional `input.canonicalization` sample byte-for-byte, recomputes the
   * Merkle root over `input.leaves` (leaf/node domain separation), and verifies
   * both the inclusion proof and the consistency proof against `input.root`.
   * Every check must hold to pass.
   */
  async verifyAuditIntegrity(input: AuditIntegrityInput): Promise<AdapterResult> {
    throw new NotImplementedError('verifyAuditIntegrity');
  }

  /**
   * TODO: evaluate MCP extension admission
   * (`org.kya-os/decentralized-authority`, SPEC-MCP-EXTENSION.md sections 3-5).
   * Reference: parses `input.serverSettings` (invalid settings reject), then
   * gates `input.request` (declaration in `params._meta`, or
   * `input.initializeCapabilities` for initialize-era carriage). Pass means the
   * request is admitted, including graceful degradation on an optional server;
   * fail means rejection with -32021, and a malformed client declaration is
   * treated as absent (fail closed).
   */
  async evaluateNegotiation(input: NegotiationInput): Promise<AdapterResult> {
    throw new NotImplementedError('evaluateNegotiation');
  }
}
