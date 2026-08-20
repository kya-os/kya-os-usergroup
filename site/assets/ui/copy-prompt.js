// copy-prompt - the [ copy prompt for your agent ] buttons. Each button is
// shipped with the `hidden` attribute (no JS, no dead button - the <details>
// fallback is the always-reachable path) and copies the text of the element
// its data-copy-target names: the SAME <pre> the fallback shows, so button
// and fallback can never disagree. Deliberately independent of the js-anim
// motion gate: copying is not motion, so reduced-motion visitors keep it.
const FEEDBACK_MS = 1600;

for (const button of document.querySelectorAll("button[data-copy-target]")) {
  const source = document.getElementById(button.getAttribute("data-copy-target"));
  if (!source || !navigator.clipboard) continue;
  button.hidden = false;
  const label = button.textContent;
  let timer = null;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(source.textContent.trim());
      button.textContent = "[ copied -> ]";
      button.classList.add("copied");
    } catch {
      // Clipboard refused (permissions, insecure context): surface the
      // manual path instead of failing silently.
      const details = source.closest("details");
      if (details) details.open = true;
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      button.textContent = label;
      button.classList.remove("copied");
    }, FEEDBACK_MS);
  });
}
