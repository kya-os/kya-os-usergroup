// revoked-walkthrough - the before / after switch on the use-cases page's
// REVOKED walkthrough. Both states ship stacked under their own headings
// (the no-JS page, always reachable); this module reveals the hidden
// segmented control and collapses the states into it: one state shown, the
// other `hidden`, aria-pressed on the buttons, arrow keys between them.
// Nothing here fetches or verifies anything: it is a walkthrough of the
// README's beats, not a network connection. Independent of the js-anim
// motion gate (a toggle is not motion); the path-highlight transition lives
// in hub.css under html.js-anim and is off under reduced motion.
const walk = document.getElementById("revoked-walkthrough");
if (walk) init(walk);

function init(walk) {
  const switcher = walk.querySelector(".walk-switch");
  const buttons = switcher ? [...switcher.querySelectorAll("button[data-walk]")] : [];
  const states = [...walk.querySelectorAll("[data-walk-state]")];
  if (buttons.length === 0 || states.length === 0) return;

  function show(name) {
    for (const state of states) state.hidden = state.getAttribute("data-walk-state") !== name;
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.getAttribute("data-walk") === name));
  }

  switcher.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-walk]");
    if (button) show(button.getAttribute("data-walk"));
  });
  // Arrow keys move between the two states like a segmented control; Tab
  // still reaches each button on its own.
  switcher.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    const from = buttons.indexOf(document.activeElement);
    if (step === 0 || from === -1) return;
    event.preventDefault();
    const next = buttons[(from + step + buttons.length) % buttons.length];
    next.focus();
    show(next.getAttribute("data-walk"));
  });
  switcher.hidden = false;
  show(buttons[0].getAttribute("data-walk"));
}
