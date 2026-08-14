# Vendored compatibility code

`src/spatial-navigation-polyfill.js` is based on WICG Spatial Navigation
commit `183f0146b6741007e46fa64ab0950447defdf8af`. Local changes are limited to:

- defensive keyboard modifier handling;
- safe handling of missing geometry values;
- preservation of zero-valued pointer coordinates;
- non-enumerable `Element` extension methods;
- guarded parent-frame access across origin boundaries;
- use of the page realm's `window.CSS` implementation;
- legacy custom-event creation through `document.createEvent` (with an
  `Event`/`detail` fallback) when `CustomEvent` is unavailable;
- webOS-specific focus boundary and checkbox behavior;
- initialization when the user script is injected after `window.load`;
- reversible installation with named listeners and exact restoration of
  pre-existing window/Element descriptors;
- an ESM marker required by the build.

`src/domrect-polyfill.js` is based on Financial Times polyfill-library commit
`c25c30e4463bef60fba1213ecb697f3e3f253d7b`. The local version adds an ESM
marker and a guard that preserves a native `DOMRect` implementation.

Current vendored SHA-256 values:

- `src/spatial-navigation-polyfill.js`:
  `a45a26fdc3399542acb3ef7497dba7c190cca894cea857c46514e73a9e2bea15`
- `src/domrect-polyfill.js`:
  `df8d563d2dd594f31142e4f27188c68c755449c01b1693760934061d10cc1606`

Owner: `zydon69`. Review horizon: whenever either upstream source is updated
or the minimum supported webOS browser changes. Exit criterion: native spatial
navigation and DOMRect support across the complete supported device matrix.
