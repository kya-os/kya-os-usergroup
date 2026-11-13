/**
 * A small line reader for the workflow files deploy-guards.test.mjs pins.
 * The repository has no runtime dependencies, so it reads the workflows
 * without a YAML library. It reads just the shape these files have, and it
 * throws, naming the line, on anything it cannot place: a reshaped file fails
 * the guards with that message instead of passing unread.
 */
import { readFileSync } from "node:fs";

/** The top-level mappings the guards read, each `key:` on a line of its own. */
const TOP_LEVEL = ["on", "permissions", "concurrency"];

/** Every top-level key of the file, in order, duplicates included. */
function topLevelKeys(lines, unreadable) {
  return lines.flatMap((line, i) => {
    if (!/^[^\s#]/.test(line)) return [];
    const key = /^([\w-]+):(?: |$)/.exec(line)?.[1];
    if (key === undefined) throw unreadable(i, "not a top-level key and its value");
    return [key];
  });
}

/**
 * The keys two spaces under a top-level `key:` line, such as `concurrency:`
 * or `on:`, each with its inline value or, when it has none, the
 * more-indented lines under it joined and dedented; undefined when the file
 * has no such line.
 */
function topLevelMapping(lines, key, unreadable) {
  const at = lines.findIndex((line) => line === `${key}:` || line.startsWith(`${key}: `));
  if (at < 0) return undefined;
  if (lines[at] !== `${key}:`) throw unreadable(at, `a top-level "${key}" given inline`);
  const mapping = {};
  let open = null; // the key whose value is the more-indented lines below it
  for (let i = at + 1; i < lines.length && !/^\S/.test(lines[i]); i++) {
    if (lines[i].trim() === "" || lines[i].trimStart().startsWith("#")) continue;
    if (open !== null && lines[i].startsWith("    ")) {
      mapping[open] = mapping[open] === "" ? lines[i].slice(4) : `${mapping[open]}\n${lines[i].slice(4)}`;
      continue;
    }
    const match = /^ {2}([\w-]+):(?: (\S.*))?$/.exec(lines[i]);
    if (match === null) throw unreadable(i, `not a key and its value under "${key}:"`);
    mapping[match[1]] = match[2] ?? "";
    open = match[2] === undefined ? match[1] : null;
  }
  return mapping;
}

/**
 * The workflow's top-level keys, its `on`, `permissions` and `concurrency`
 * mappings, and its jobs, each with its own keys and its steps, from the
 * file's text: job ids two spaces deep, job keys four, the steps list six,
 * step keys eight. A key's value is its inline text, or the more-indented
 * lines under it (a `run: |` script, a `with:` or `env:` mapping) joined and
 * dedented.
 * Each step records the lines it spans, from and to.
 * @returns {{ lines: string[], topLevelKeys: string[], on?: object, permissions?: object, concurrency?: object, jobs: Record<string, { keys: object, steps: object[] }> }}
 */
export function parseWorkflow(text, file) {
  const lines = text.split("\n");
  const unreadable = (i, why) =>
    new Error(`${file}:${i + 1}: ${why}; deploy-guards.test.mjs cannot read this file's shape, so update its line reader with the file:\n  ${lines[i] ?? ""}`);
  const keys = topLevelKeys(lines, unreadable);
  const mappings = Object.fromEntries(TOP_LEVEL.map((key) => [key, topLevelMapping(lines, key, unreadable)]));
  const start = lines.indexOf("jobs:");
  if (start < 0) throw unreadable(0, 'no top-level "jobs:" line');
  const jobs = {};
  let job = null;
  let step = null;
  let open = null; // the key whose value continues on the more-indented lines below it
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const indent = line.search(/\S/);
    if (open !== null && (indent > open.indent || (indent < 0 && open.block))) {
      if (!open.block) throw unreadable(i, "a value that continues on the next line");
      if (indent >= 0) open.depth ??= indent;
      if (indent >= 0 && indent < open.depth) throw unreadable(i, "a line less indented than the block it belongs to");
      open.text.push(indent < 0 ? "" : line.slice(open.depth));
      open.owner[open.key] = open.text.join("\n").replace(/\n+$/, "");
      if (step !== null && open.owner === step.keys) step.to = i;
      continue;
    }
    open = null;
    if (indent < 0 || line.trimStart().startsWith("#")) continue;
    if (indent === 0) break;
    const match = /^ *(- )?([\w-]+):(?: (.+))?$/.exec(line);
    if (match === null) throw unreadable(i, "not a key and its value");
    const [, dash, key, value = ""] = match;
    let owner;
    if (!dash && indent === 2 && value === "") {
      job = jobs[key] = { keys: {}, steps: [] };
      step = null;
      continue;
    } else if (!dash && indent === 4 && job !== null) {
      owner = job.keys;
    } else if (dash && indent === 6 && job !== null && "steps" in job.keys) {
      step = { keys: {}, from: i, to: i };
      job.steps.push(step);
      owner = step.keys;
    } else if (!dash && indent === 8 && step !== null) {
      owner = step.keys;
      step.to = i;
    } else {
      throw unreadable(i, "a key at a depth this reader does not expect");
    }
    owner[key] = value;
    // A job's steps are read as steps, not as the text of its steps key.
    if (owner !== job.keys || key !== "steps") open = { owner, key, block: value === "" || value === "|", indent: dash ? indent + 2 : indent, text: [] };
  }
  return { lines, topLevelKeys: keys, ...mappings, jobs };
}

/** The workflow at `file`, a path from the repository root, read as parseWorkflow reads it. */
export const readWorkflow = (file) => parseWorkflow(readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8"), file);
