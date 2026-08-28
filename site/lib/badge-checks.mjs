/**
 * Badge render checks, on the finished dist/badge/ bytes - split from
 * lib/badge.mjs for the lib LOC cap, same philosophy as the other check
 * modules: read the shipped files back and reconstruct what they should say
 * WITHOUT the renderer that wrote them, so a regression in a renderer cannot
 * make its own check pass.
 *
 * What is proven here: exactly one .svg + .json pair per rendered entry;
 * every message and color agrees with the entry refined by the build's
 * cryptographic verdict; "verified" appears only where a credential actually
 * verified; a subset never renders as a bare level; and the SIGNATURE WAVE
 * appears exactly on the credential-backed badges, seeded by the proofValue
 * of the credential that SHIPPED (re-derived here from dist/credentials/
 * through the worker's independent implementation), never twice the same.
 *
 * Plus the static/worker seam: the worker's renderer must emit byte-identical
 * bytes for every state either tier can produce, and both tiers must derive
 * the same wave seed from the same credential - the blessed form of "single
 * source of truth" under the deliberate redundancy rule, a parity assertion
 * instead of shared code, so the worker stays importable by Cloudflare with
 * no site/ dependency while the two renderers provably cannot drift apart.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
// The worker's OWN renderer and wave, imported read-only for the parity
// assertions below - the check may look at both sides; the worker itself
// never imports site/ or scripts/ code (deliberate redundancy rule).
import { renderJson as workerRenderJson, renderSvg as workerRenderSvg } from "../../workers/badge/worker.mjs";
import { credentialWaveSeed as workerCredentialWaveSeed } from "../../workers/badge/wave.mjs";
import { LABEL, WAVE_BARS, renderBadgeJson, renderBadgeSvg } from "./badge.mjs";
import { assertBuild } from "./checks.mjs";
import { esc } from "./html.mjs";
import { credentialWaveSeed } from "./waveform.mjs";

const CREDENTIAL_URL_RE = /^https:\/\/builders\.kya-os\.org\/credentials\/([0-9a-f]{32})\.json$/;

/**
 * The wave seed for a credential-backed entry, re-derived from the SHIPPED
 * dist/credentials/ bytes through the WORKER's independent implementation -
 * so the check proves the emitted bars are a fingerprint of the signature
 * that actually deploys, and proves the two tiers derive it identically.
 */
function shippedWaveSeed(distDir, verdict, slug) {
  const match = CREDENTIAL_URL_RE.exec(verdict.attestationUrl ?? "");
  assertBuild(match !== null, `badge check for "${slug}": the verdict's attestationUrl is not a canonical credential URL`);
  const credential = JSON.parse(readFileSync(join(distDir, "credentials", `${match[1]}.json`), "utf8"));
  const seed = workerCredentialWaveSeed(credential);
  assertBuild(
    seed === verdict.waveSeed,
    `badge check for "${slug}": the wave seed the build drew with (${verdict.waveSeed}) is not the one the shipped ` +
      `credential's proof.proofValue derives (${seed}) - the badge would not fingerprint the signature it ships`,
  );
  return seed;
}

/**
 * The expected badge message, color, and wave seed for one entry,
 * reconstructed WITHOUT badgeState or the formatters (assertion philosophy:
 * a regression in a renderer cannot make its own check pass). The verdict is
 * data from the build's independent cryptographic verification, not renderer
 * output, and the seed is re-derived from the shipped credential bytes.
 */
function expectedBadge(entry, verdict, distDir) {
  const c = entry.conformance;
  const label = c && (c.scope === "subset" ? `${c.level} subset (${c.categories.join(", ")})` : `${c.level} full`);
  if (!c) return { message: "· listed", color: "999999" };
  if (c.status === "verified" || c.status === "revoked") {
    const wave = shippedWaveSeed(distDir, verdict, entry.slug);
    if (verdict.state === "revoked") return { message: "revoked", color: "6e7681", wave };
    if (verdict.state === "suspended") return { message: "◌ under appeal", color: "ffb340", wave };
    return { message: `✓ ${label} verified`, color: "00c86e", wave };
  }
  if (c.status === "in-verification") return { message: `◌ ${label} in verification`, color: "ffb340" };
  return { message: `· ${label} self-reported`, color: "999999" };
}

/** Every <rect> in a badge SVG that carries a fill-opacity: the wave bars. */
const waveBarsOf = (svg) => [...svg.matchAll(/<rect [^>]*fill-opacity="[^"]*"\/>/g)].map((m) => m[0]);

/**
 * Badge render checks, on the finished dist/badge/ bytes: exactly one
 * .svg + .json pair per rendered entry, each carrying the expected state.
 * "verified" may appear in a badge file ONLY for an entry whose credential
 * this build cryptographically verified with clean status bits; a subset
 * never renders as a bare level; banned terms appear nowhere; and the
 * signature wave appears exactly on the credential-backed badges, drawn
 * from the shipped credential's own signature and never twice the same.
 */
export function assertBadges(distDir, rendered, verdicts) {
  const badgeDir = join(distDir, "badge");
  const barsBySlug = new Map();
  const emitted = readdirSync(badgeDir).sort();
  const expectedFiles = rendered.flatMap((entry) => [`${entry.slug}.json`, `${entry.slug}.svg`]).sort();
  assertBuild(
    emitted.join(",") === expectedFiles.join(","),
    `dist/badge/ must hold exactly one .svg + .json pair per rendered entry (found: ${emitted.join(", ")})`,
  );
  for (const entry of rendered) {
    const c = entry.conformance;
    const verdict = verdicts.get(entry.slug);
    assertBuild(
      !(c?.status === "verified" || c?.status === "revoked") || verdict !== undefined,
      `entry "${entry.slug}" reached badge assertion at status "${c?.status}" without a build verdict - the verifier must refuse first`,
    );
    const { message, color, wave = null } = expectedBadge(entry, verdict, distDir);

    for (const ext of ["svg", "json"]) {
      const path = join(badgeDir, `${entry.slug}.${ext}`);
      assertBuild(statSync(path).size > 0, `dist/badge/${entry.slug}.${ext} is missing or empty`);
    }
    const svg = readFileSync(join(badgeDir, `${entry.slug}.svg`), "utf8");
    assertBuild(
      svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && svg.endsWith("</svg>\n") && !/&(?!amp;|lt;|gt;|quot;|#)/.test(svg),
      `dist/badge/${entry.slug}.svg is not a well-formed standalone SVG`,
    );
    assertBuild(svg.includes(`>${LABEL}</text>`), `dist/badge/${entry.slug}.svg lost its ${LABEL} label cell`);
    assertBuild(svg.includes(`>${esc(message)}</text>`), `dist/badge/${entry.slug}.svg message does not match the entry's state ("${message}")`);
    const shields = JSON.parse(readFileSync(join(badgeDir, `${entry.slug}.json`), "utf8"));
    assertBuild(
      Object.keys(shields).sort().join(",") === "color,label,message,schemaVersion",
      `dist/badge/${entry.slug}.json must carry exactly the shields endpoint keys {schemaVersion, label, message, color}`,
    );
    assertBuild(shields.schemaVersion === 1 && shields.label === LABEL, `dist/badge/${entry.slug}.json label/schemaVersion drifted`);
    assertBuild(shields.message === message, `dist/badge/${entry.slug}.json message does not match the entry's state ("${message}")`);
    assertBuild(shields.color === color, `dist/badge/${entry.slug}.json color does not match the entry's tier (${color})`);
    for (const [ext, bytes] of [["svg", svg], ["json", JSON.stringify(shields)]]) {
      assertBuild(!/certified|certification/i.test(bytes), `banned term leaked into dist/badge/${entry.slug}.${ext}`);
      assertBuild(
        bytes.includes("verified") === (verdict?.state === "verified"),
        `"verified" in dist/badge/${entry.slug}.${ext} must appear exactly when the build verified the credential (state: ${verdict?.state ?? "none"})`,
      );
    }
    if (c?.scope === "subset" && shields.message.includes(c.level)) {
      assertBuild(shields.message.includes(`${c.level} subset (`), `subset badge for "${entry.slug}" must name its categories, never a bare level`);
    }

    // The signature wave: exactly the credential-backed badges carry bars,
    // one per WAVE_BARS, in the state color. Everything below the credential
    // boundary stays flat - there is no signature to fingerprint yet.
    const bars = waveBarsOf(svg);
    assertBuild(
      bars.length === (wave === null ? 0 : WAVE_BARS),
      `dist/badge/${entry.slug}.svg carries ${bars.length} wave bars; a badge minted from a verified credential carries ` +
        `${WAVE_BARS} and every other badge carries none`,
    );
    if (wave !== null) {
      assertBuild(
        bars.every((bar) => bar.includes(`fill="#${color}"`)),
        `dist/badge/${entry.slug}.svg draws wave bars in a color other than its state tier (#${color})`,
      );
      barsBySlug.set(entry.slug, bars.join(""));
    }

    // Static/worker seam: at deploy the worker takes over these exact paths,
    // so its renderer must reproduce the SHIPPED bytes for the same state -
    // wave included, from the seed re-derived off the shipped credential.
    assertBuild(
      workerRenderSvg({ message, color, wave }) === svg,
      `dist/badge/${entry.slug}.svg differs from the worker renderer's bytes for the same state - the /badge/ handover would flicker`,
    );
    assertBuild(
      workerRenderJson({ message, color }) === readFileSync(join(badgeDir, `${entry.slug}.json`), "utf8"),
      `dist/badge/${entry.slug}.json differs from the worker renderer's bytes for the same state`,
    );
  }

  // Every credential draws its own wave: two badges may share a message and
  // a color, never a bar pattern, because no two credentials share a
  // signature. Asserted on the emitted rect geometry, not on the seeds.
  const patterns = new Map();
  for (const [slug, pattern] of barsBySlug) {
    const twin = patterns.get(pattern);
    assertBuild(
      twin === undefined,
      `dist/badge/${slug}.svg draws the same bar pattern as dist/badge/${twin}.svg - two credentials cannot fingerprint alike`,
    );
    patterns.set(pattern, slug);
  }
  assertWorkerRenderParity();
}

/**
 * Renderer parity across the WHOLE state space, not just the states the
 * registry happens to occupy today: the worker's self-contained renderer
 * (workers/badge/worker.mjs) must emit byte-identical SVG and shields JSON
 * to this module's for every badge state either tier can produce. This is
 * the blessed form of "single source of truth" under the deliberate
 * redundancy rule: a parity assertion instead of shared code, so the worker
 * stays importable by Cloudflare with no site/ dependency while the two
 * renderers provably cannot drift apart.
 */
function assertWorkerRenderParity() {
  const wave = "kya-os:sig:1a2b3c4d";
  const states = [
    { message: "· listed", color: "999999" },
    { message: "· L2 full self-reported", color: "999999" },
    { message: "◌ L1 subset (signed-proof, status-list) in verification", color: "ffb340" },
    { message: "✓ L3 full verified", color: "00c86e", wave },
    { message: "✓ L1 subset (signed-proof) verified", color: "00c86e", wave: "kya-os:sig:00000001" },
    { message: "◌ under appeal", color: "ffb340", wave },
    { message: "revoked", color: "6e7681", wave },
    { message: "unverified", color: "999999" },
    { message: `escaping & <edge> "case" 'too'`, color: "999999" },
  ];
  for (const state of states) {
    assertBuild(
      workerRenderSvg(state) === renderBadgeSvg(state),
      `worker and static SVG renderers diverged for "${state.message}" - the /badge/ handover would change bytes`,
    );
    assertBuild(
      workerRenderJson(state) === renderBadgeJson(state),
      `worker and static shields JSON renderers diverged for "${state.message}"`,
    );
  }

  // The DERIVATION, not just the drawing: both tiers must read the same
  // field of the same credential and reach the same seed, or a badge would
  // redraw itself the moment the worker took over the path. Sample proofs
  // only - the shipped credentials are checked per entry above.
  for (const proofValue of ["z4Qe9uXqcL237yGd5P6uX116", "z57yM2uPKZ6uaxBuowXXpdpj", "z"]) {
    const credential = { proof: { type: "DataIntegrityProof", proofValue } };
    assertBuild(
      workerCredentialWaveSeed(credential) === credentialWaveSeed(credential),
      `worker and static wave seeds diverged for proofValue "${proofValue}" - the badge would redraw at the tier handover`,
    );
  }
  for (const empty of [{}, { proof: {} }, { proof: { proofValue: "" } }]) {
    let threw = false;
    try {
      credentialWaveSeed(empty);
    } catch {
      threw = true;
    }
    assertBuild(threw, "credentialWaveSeed must throw when there is no signature to fingerprint (fail closed, never a blank wave)");
  }
}
