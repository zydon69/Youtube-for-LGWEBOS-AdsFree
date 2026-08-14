# Compatibility matrix

This project distinguishes syntax compatibility from physical-device
validation. A row marked “not yet verified” is not a promise of support.

| webOS family | Approximate browser baseline | Automated status                                     | Physical TV status |
| ------------ | ---------------------------- | ---------------------------------------------------- | ------------------ |
| 1–2          | Safari 7–8 class             | ES5 bundle syntax checked                            | Not yet verified   |
| 3–4          | Chromium 38–53 class         | ES5 bundle syntax checked                            | Not yet verified   |
| 5–6          | Chromium 68–79 class         | ES5 bundle syntax and current Chromium flows checked | Not yet verified   |
| 7–9          | Chromium 87–108 class        | ES5 bundle syntax and current Chromium flows checked | Not yet verified   |

Every release candidate must record the date, TV model, webOS/firmware and the
result of installation, launch, sign-in/navigation, playback, settings,
screen-hidden mode, ad filtering, quality selection and SponsorBlock opt-in.
SponsorBlock is intentionally unavailable when the browser transport cannot
enforce no redirects and no referrer leakage; that does not disable local
features.

No release may replace “not yet verified” with “verified” without a retained
device test record tied to the exact commit and IPK SHA-256.
