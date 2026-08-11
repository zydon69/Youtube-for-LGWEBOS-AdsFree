# Vendored compatibility code

`src/spatial-navigation-polyfill.js` is based on WICG Spatial Navigation
commit `183f0146b6741007e46fa64ab0950447defdf8af`. Local changes are limited to:

- defensive keyboard modifier handling;
- safe handling of missing geometry values;
- webOS-specific focus boundary and checkbox behavior;
- initialization when the user script is injected after `window.load`;
- an ESM marker required by the build.

`src/domrect-polyfill.js` is based on Financial Times polyfill-library commit
`c25c30e4463bef60fba1213ecb697f3e3f253d7b` and only adds an ESM marker.

Owner: `zydon69`. Review horizon: whenever either upstream source is updated
or the minimum supported webOS browser changes. Exit criterion: native spatial
navigation and DOMRect support across the complete supported device matrix.
