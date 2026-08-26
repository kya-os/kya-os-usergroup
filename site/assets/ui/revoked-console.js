// revoked-console - the REVOKED showcase console on the use-cases page: the
// README's beats (examples/revoked/README.md lines 69-72 and the verify run)
// as a triggered sequence, the payment in focus. The markup ships in its
// FINAL state - five lines, signal dots for the delegation and the payment,
// alert dots from the kill on, the signed-proof lockup greyed and struck -
// so no JS, blocked JS, and reduced motion all read the finished story.
// Under the html.js-anim gate only (the same test page-fx.js applies), this
// module hides the lines, reveals the [ send payment ] button, and on click
// replays the beats with class toggles on timeouts: nothing here talks to a
// chain. Cadence: one beat per 500ms; the payment beat holds twice as long
// so the signed proof lands before the kill, and the button reads
// [ replay ] once the verify line is down.
const BEAT_MS = 500;
const PROOF_MS = 350; // the proof lands this long after the payment line

const root = document.getElementById("revoked-console");
const animated =
  document.documentElement.classList.contains("js-anim") &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches;
if (root && animated) init(root);

function init(root) {
  const lines = [...root.querySelectorAll(".fc-line")];
  const proof = root.querySelector(".fc-proof");
  const button = root.querySelector(".fc-btn");
  if (lines.length !== 5 || !proof || !button) return;
  let playing = false;
  const show = (i) => lines[i].classList.add("on");
  // [at ms, what lands]: beats 1-5 in README order. The kill (beat 3) flips
  // the tone; the refusal (beat 4) strikes the proof - it still verifies,
  // the status bit killed it.
  const steps = [
    [0, () => show(0)],
    [BEAT_MS, () => show(1)],
    [BEAT_MS + PROOF_MS, () => proof.classList.add("on")],
    [3 * BEAT_MS, () => show(2)],
    [4 * BEAT_MS, () => { root.classList.add("fc-killed"); show(3); }],
    [5 * BEAT_MS, () => { show(4); button.textContent = "[ replay ]"; playing = false; }],
  ];

  function play() {
    if (playing) return;
    playing = true;
    root.classList.remove("fc-killed");
    proof.classList.remove("on");
    for (const line of lines) line.classList.remove("on");
    for (const [ms, land] of steps) setTimeout(land, ms);
  }

  button.addEventListener("click", play);
  root.classList.remove("fc-killed");
  root.classList.add("fc-armed");
  button.hidden = false;
}
