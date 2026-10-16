# Releasing

`dist/` is gitignored. A clean checkout is not publishable until `./scripts/build.sh` has run. `npm pack` / `npm publish` run `prepack`, which fails if the wasm modules or license files are missing.

1. Set `version` in `package.json` (keep it aligned with the libavif pin when possible).
2. Tag `v<version>` and push the tag.
3. The Release workflow builds in Docker, tests, verifies `npm pack` contents, creates the GitHub Release, and runs `npm publish --access public --provenance`.

Configure [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) for `@phenomen/libavif-wasm` on this GitHub repository, or set the `NPM_TOKEN` Actions secret.

Local dry-run after a build:

```bash
npm run pack:check
```
