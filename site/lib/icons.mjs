/**
 * Self-drawn inline SVG glyphs for the site build: 16x16 line icons on a
 * currentColor stroke, so they take the surrounding text's tone in both
 * themes with no palette of their own. Inline SVG in the HTML rides
 * style-src / img-src 'self' untouched (no external asset, no style
 * attribute), and every glyph is decorative (aria-hidden): the text label
 * beside it carries the meaning. No trademark or vendor mark is drawn here.
 *
 * Used by the authorization-methods row on the use-cases page
 * (lib/use-cases.mjs), one glyph per AuthorizationRequirement type.
 */

// name -> the path data inside the shared 16x16 frame.
const GLYPHS = {
  // A key: the oauth type (an authorization-code / OIDC flow).
  key: '<circle cx="5.5" cy="10.5" r="3"/><path d="M7.6 8.4 14 2M11.5 4.5l2 2M13 3l1.5 1.5"/>',
  // An id card: the mdl type (an ISO mDL presentation).
  "id-card": '<rect x="1.5" y="3" width="13" height="10" rx="1"/><circle cx="5.5" cy="7.5" r="1.5"/><path d="M3.5 11.5c.4-1.2 1.1-1.8 2-1.8s1.6.6 2 1.8M9.5 6.5h3M9.5 9.5h3"/>',
  // A person with a check: the idv type (an identity-verification flow).
  "person-check": '<circle cx="6.5" cy="5" r="2.5"/><path d="M2 14c0-2.7 2-4.5 4.5-4.5 1 0 1.9.3 2.6.8M10 12l1.5 1.5L15 10"/>',
  // A seal with a ribbon: the credential type (a directly held verifiable credential).
  seal: '<circle cx="8" cy="6" r="4"/><path d="M5.6 9.3 4.5 15l3.5-2 3.5 2-1.1-5.7"/>',
  // A checked square: the none type (no authorization beyond consent itself).
  "check-square": '<rect x="2" y="2" width="12" height="12" rx="1"/><path d="M5 8.2l2 2L11 6"/>',
};

/** One decorative 16x16 glyph by name; throws on an unknown name so a typo fails the build. */
export function icon(name) {
  const body = GLYPHS[name];
  if (body === undefined) throw new Error(`icons.mjs: unknown glyph "${name}"`);
  return `<svg class="glyph" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}
