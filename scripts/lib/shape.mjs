/**
 * Schema-lite structural checks for the program's committed credential
 * artifacts, mirroring registry/credentials/schema/attestation-v1.json the
 * same way scripts/validate.mjs mirrors the two registry schemas (Ajv-free
 * house rule: keep the schema file and this module in sync when the shape
 * changes). Shared by the validator, the site build, and the public
 * verifier, so one implementation decides what "well-formed" means on this
 * side of the deliberate-redundancy boundary (the badge worker keeps its own
 * independent checks - see workers/badge/verify.mjs).
 *
 * Every check fails closed: unknown properties, a validUntil in any
 * position, a drifted terms statement, an id that does not recompute from
 * the subject fields - each is a named error, never a warning.
 */
import {
  CREDENTIAL_TYPE,
  ISSUER_DID,
  SCHEMA_URL,
  STATUS_LIST_BITS,
  STATUS_LIST_URLS,
  STATUS_PURPOSES,
  TERMS_STATEMENT,
  credentialIdFor,
  isSubjectId,
} from "./attest.mjs";

const CREDENTIAL_KEYS = ["@context", "id", "type", "issuer", "validFrom", "credentialSchema", "credentialSubject", "credentialStatus", "termsOfUse", "proof"];
const SUBJECT_KEYS = ["id", "implementation", "level", "scope", "categories", "suite"];
const IMPLEMENTATION_KEYS = ["name", "version", "repo", "digest"];
const SUITE_KEYS = ["package", "packageVersion", "suiteVersion", "vectorSetHash", "vectorCount"];
const STATUS_ENTRY_KEYS = ["type", "statusPurpose", "statusListIndex", "statusListCredential"];
const PROOF_KEYS = ["type", "cryptosuite", "created", "verificationMethod", "proofPurpose", "proofValue"];
const LIST_KEYS = ["@context", "id", "type", "issuer", "validFrom", "credentialSubject", "proof"];
const LIST_SUBJECT_KEYS = ["id", "type", "statusPurpose", "encodedList"];

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const VECTOR_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const INDEX_RE = /^(0|[1-9][0-9]*)$/;
const SLUGISH_RE = /^[a-z0-9-]{2,40}$/;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value, max = 200) => typeof value === "string" && value.length >= 1 && value.length <= max;

function checkExactKeys(value, allowed, label, fail, { optional = [] } = {}) {
  if (!isObject(value)) {
    fail(`${label} must be an object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label}: unexpected property "${key}" (allowed: ${allowed.join(", ")})`);
  }
  for (const key of allowed) {
    if (value[key] === undefined && !optional.includes(key)) fail(`${label}: "${key}" is required`);
  }
  return true;
}

function checkContextAndIssuer(document, fail) {
  const context = document["@context"];
  if (!Array.isArray(context) || context.length !== 1 || context[0] !== "https://www.w3.org/ns/credentials/v2") {
    fail('"@context" must be exactly ["https://www.w3.org/ns/credentials/v2"]');
  }
  if (document.issuer !== ISSUER_DID) fail(`"issuer" must be ${ISSUER_DID}`);
  if (!DATETIME_RE.test(document.validFrom ?? "") || !Number.isFinite(Date.parse(document.validFrom))) {
    fail('"validFrom" must be an ISO 8601 UTC datetime (YYYY-MM-DDTHH:MM:SSZ)');
  }
  if (document.validUntil !== undefined) {
    fail('"validUntil" is forbidden: the credential design has no expiry (currency lives in suite supersession)');
  }
}

function checkProof(proof, expectedVerificationMethod, fail) {
  if (!checkExactKeys(proof, PROOF_KEYS, "proof", fail)) return;
  if (proof.type !== "DataIntegrityProof") fail('proof.type must be "DataIntegrityProof"');
  if (proof.cryptosuite !== "eddsa-jcs-2022") fail('proof.cryptosuite must be "eddsa-jcs-2022"');
  if (proof.proofPurpose !== "assertionMethod") fail('proof.proofPurpose must be "assertionMethod"');
  if (!DATETIME_RE.test(proof.created ?? "")) fail("proof.created must be an ISO 8601 UTC datetime");
  const escapedDid = ISSUER_DID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const vmRe = new RegExp(`^${escapedDid}#${expectedVerificationMethod}-[1-9][0-9]*$`);
  if (typeof proof.verificationMethod !== "string" || !vmRe.test(proof.verificationMethod)) {
    fail(`proof.verificationMethod must be a ${ISSUER_DID}#${expectedVerificationMethod}-<n> key`);
  }
  if (typeof proof.proofValue !== "string" || !proof.proofValue.startsWith("z")) {
    fail("proof.proofValue must be base58btc multibase (z-prefixed)");
  }
}

/**
 * Structural check for one committed KyaOsConformanceAttestation credential.
 * @returns {string[]} every violation, each prefixed with `label`.
 */
export function checkCredentialShape(credential, label) {
  const errors = [];
  const fail = (message) => errors.push(`${label}: ${message}`);
  if (!checkExactKeys(credential, CREDENTIAL_KEYS, "credential", fail, { optional: ["proof"] })) return errors;

  checkContextAndIssuer(credential, fail);
  const type = credential.type;
  if (!Array.isArray(type) || type.length !== 2 || type[0] !== "VerifiableCredential" || type[1] !== CREDENTIAL_TYPE) {
    fail(`"type" must be exactly ["VerifiableCredential", "${CREDENTIAL_TYPE}"]`);
  }
  const schema = credential.credentialSchema;
  if (!isObject(schema) || schema.id !== SCHEMA_URL || schema.type !== "JsonSchema" || Object.keys(schema).length !== 2) {
    fail(`"credentialSchema" must be exactly {"id": "${SCHEMA_URL}", "type": "JsonSchema"}`);
  }

  const subject = credential.credentialSubject;
  if (checkExactKeys(subject, SUBJECT_KEYS, "credentialSubject", fail, { optional: ["categories"] })) {
    if (!isSubjectId(subject.id)) fail("credentialSubject.id must be an https URL or a DID");
    if (!["L1", "L2", "L3"].includes(subject.level)) fail("credentialSubject.level must be one of L1, L2, L3");
    if (subject.scope !== "full" && subject.scope !== "subset") fail('credentialSubject.scope must be "full" or "subset"');
    if (subject.scope === "subset") {
      const categories = subject.categories;
      if (!Array.isArray(categories) || categories.length === 0 || !categories.every((c) => SLUGISH_RE.test(c))) {
        fail("a subset claim must carry non-empty slug-shaped categories (a subset never renders as a bare level)");
      } else {
        if (new Set(categories).size !== categories.length) fail("credentialSubject.categories must not contain duplicates");
        if ([...categories].sort().join(",") !== categories.join(",")) {
          fail("credentialSubject.categories must be sorted (the deterministic id depends on it)");
        }
      }
    } else if (subject.categories !== undefined) {
      fail("a full claim must not carry categories");
    }
    const impl = subject.implementation;
    if (checkExactKeys(impl, IMPLEMENTATION_KEYS, "credentialSubject.implementation", fail, { optional: ["repo"] })) {
      if (!isNonEmptyString(impl.name, 80)) fail("implementation.name must be a string of 1-80 characters");
      if (!isNonEmptyString(impl.version, 64)) fail("implementation.version must be a string of 1-64 characters");
      if (impl.repo !== undefined && !/^https:\/\//.test(impl.repo)) fail("implementation.repo must be an https URL");
      if (!isObject(impl.digest) || Object.keys(impl.digest).length !== 1 || !/^[0-9a-f]{40}$/.test(impl.digest.gitCommit ?? "")) {
        fail('implementation.digest must be exactly {"gitCommit": "<40-hex commit SHA>"}');
      }
    }
    const suite = subject.suite;
    if (checkExactKeys(suite, SUITE_KEYS, "credentialSubject.suite", fail)) {
      if (suite.package !== "@kya-os/mcp") fail('suite.package must be "@kya-os/mcp"');
      if (!SEMVER_RE.test(suite.packageVersion ?? "")) fail("suite.packageVersion must be semver");
      if (!SEMVER_RE.test(suite.suiteVersion ?? "")) fail("suite.suiteVersion must be semver");
      if (!VECTOR_HASH_RE.test(suite.vectorSetHash ?? "")) fail("suite.vectorSetHash must be sha256:<64 hex>");
      if (!Number.isInteger(suite.vectorCount) || suite.vectorCount < 1) fail("suite.vectorCount must be a positive integer");
    }
    // The deterministic id must recompute from the subject fields exactly.
    if (errors.length === 0) {
      const expected = credentialIdFor({
        subjectId: subject.id,
        suiteVersion: subject.suite.suiteVersion,
        vectorSetHash: subject.suite.vectorSetHash,
        level: subject.level,
        scope: subject.scope,
        categories: subject.categories,
      });
      if (credential.id !== expected.id) {
        fail(`"id" (${credential.id}) does not recompute from the subject fields (expected ${expected.id})`);
      }
    } else if (!/^urn:kya:conf:[0-9a-f]{32}$/.test(credential.id ?? "")) {
      fail('"id" must match urn:kya:conf:<32 hex>');
    }
  }

  const statuses = credential.credentialStatus;
  if (!Array.isArray(statuses) || statuses.length !== 2) {
    fail('"credentialStatus" must be an array of exactly two BitstringStatusListEntry objects (revocation, suspension)');
  } else {
    const indexes = new Set();
    statuses.forEach((entry, i) => {
      const purpose = STATUS_PURPOSES[i];
      if (!checkExactKeys(entry, STATUS_ENTRY_KEYS, `credentialStatus[${i}]`, fail)) return;
      if (entry.type !== "BitstringStatusListEntry") fail(`credentialStatus[${i}].type must be "BitstringStatusListEntry"`);
      if (entry.statusPurpose !== purpose) fail(`credentialStatus[${i}].statusPurpose must be "${purpose}"`);
      if (entry.statusListCredential !== STATUS_LIST_URLS[purpose]) {
        fail(`credentialStatus[${i}].statusListCredential must be ${STATUS_LIST_URLS[purpose]}`);
      }
      if (!INDEX_RE.test(entry.statusListIndex ?? "") || Number(entry.statusListIndex) >= STATUS_LIST_BITS) {
        fail(`credentialStatus[${i}].statusListIndex must be a decimal string in [0, ${STATUS_LIST_BITS})`);
      }
      indexes.add(entry.statusListIndex);
    });
    if (indexes.size > 1) fail("both credentialStatus entries must share one allocated index");
  }

  const terms = credential.termsOfUse;
  if (!Array.isArray(terms) || terms.length !== 1 || !isObject(terms[0]) || Object.keys(terms[0]).length !== 2 ||
    terms[0].type !== "KyaOsConformanceTerms" || terms[0].statement !== TERMS_STATEMENT) {
    fail('"termsOfUse" must be exactly [{type: "KyaOsConformanceTerms", statement: <the pinned terms statement>}]');
  }

  if (credential.proof !== undefined) checkProof(credential.proof, "conformance-issuer", fail);
  return errors;
}

/**
 * Structural check for one committed BitstringStatusListCredential.
 * @returns {string[]} every violation, each prefixed with `label`.
 */
export function checkStatusListShape(list, purpose, label) {
  const errors = [];
  const fail = (message) => errors.push(`${label}: ${message}`);
  if (!checkExactKeys(list, LIST_KEYS, "status list", fail)) return errors;
  checkContextAndIssuer(list, fail);
  const type = list.type;
  if (!Array.isArray(type) || type.length !== 2 || type[0] !== "VerifiableCredential" || type[1] !== "BitstringStatusListCredential") {
    fail('"type" must be exactly ["VerifiableCredential", "BitstringStatusListCredential"]');
  }
  if (list.id !== STATUS_LIST_URLS[purpose]) fail(`"id" must be ${STATUS_LIST_URLS[purpose]}`);
  const subject = list.credentialSubject;
  if (checkExactKeys(subject, LIST_SUBJECT_KEYS, "credentialSubject", fail)) {
    if (subject.id !== `${STATUS_LIST_URLS[purpose]}#list`) fail(`credentialSubject.id must be ${STATUS_LIST_URLS[purpose]}#list`);
    if (subject.type !== "BitstringStatusList") fail('credentialSubject.type must be "BitstringStatusList"');
    if (subject.statusPurpose !== purpose) fail(`credentialSubject.statusPurpose must be "${purpose}"`);
    if (typeof subject.encodedList !== "string" || !subject.encodedList.startsWith("u")) {
      fail("credentialSubject.encodedList must be multibase base64url (u-prefixed)");
    }
  }
  checkProof(list.proof, "conformance-status", fail);
  return errors;
}
