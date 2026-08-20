# Vendored motion modules

The five modules below are byte-identical copies of kya-os-site's vanilla motion layer, so the hub's page transitions and entry choreography run the exact same code as kya-os.org.
`hub-init.js` is NOT vendored: it is the hub's own entry point (the counterpart of kya-os-site's `PageInit.js`, which targets that site's DOM and is deliberately not copied).

- Source repo: [kya-os/kya-os-site](https://github.com/kya-os/kya-os-site), path `src/ui/`.
- Source commit: `9be55b88bc6b05afa174c5230218af79bcd82ebf`.

| File | sha256 |
| --- | --- |
| GlitchText.js | `7ddc58770d7677de9c38b3bd096f6d7103e366e5d1f532eba36569436248a81c` |
| PageTransition.js | `179e109bdacf6a24c52fc412b75676fbe997b635ead940de1b5a280fec992e7a` |
| SmoothScroll.js | `27179c8ffd18a87dc9ed4781d3b858a4be8686dc3e97b23beb0e61e87fbdc93b` |
| Title.js | `3fbfc6d1375a17f4015fc714deab9edc483f89161a6aec7ecce155f117ec1338` |
| UIUtils.js | `eb03cfa3bd58c0f8075c7c37a7e8249676f202c1ea68defe2400a57c32380f10` |

**Update rule: update = re-copy from source, never edit in place.**
The build fails if any vendored file drifts from its hash above, or if any `dist/ui/*.js` is not a byte copy of this directory (see `site/lib/assertions.mjs`).

The overlay/entry CSS that accompanies these modules lives in `site/lib/theme.mjs` (`MOTION_CSS`), adapted from kya-os-site `css/main.css` with ONLY color values changed to the hub's theme tokens (documented divergence: the transition overlay wipes in `var(--page)`, not hard `#0a0a0a`, because the hub has a light mode).

Planned durable fix: extract these modules into a shared `@kya-os/motion` package so both sites consume one published source instead of vendored copies.
