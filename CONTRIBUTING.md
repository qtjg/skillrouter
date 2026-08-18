# Contributing to SkillRouter

Thanks for contributing. This project is in early development; see [IMPLEMENTATION.md](IMPLEMENTATION.md) for what is done, in progress, and pending.

## Set up

Requirements: Node.js >= 22.5 (24.x or >= 22.18 recommended for stable type stripping).

```sh
git clone https://github.com/qtjg/skillrouter
cd skillrouter
npm install
npm run typecheck   # strict TypeScript, must pass before submitting anything
```

On Node 22.5–22.17, run the CLI with the type-transform flag:

```sh
node --experimental-transform-types src/cli/index.ts doctor
```

On Node >= 22.18 / 24, plain execution works; the installed binary is `bin/skillrouter.js` (built output).

## Conventions

- **Strict TypeScript** (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, NodeNext resolution). Resolve every type error; do not loosen compiler flags.
- **Keep dependencies minimal.** The runtime dependency set is intentionally `yaml` only — everything else uses Node built-ins.
- **Domain layout.** Code lives under `src/<domain>/`: `cli`, `core`, `manifest`, `router`, `registry`, `security`, `runtime`, `adapters`, `storage`, `config`, `logging`, project analysis (`project`), git context (`git`), `utils`. Follow the boundaries already established there.
- **Commits** follow Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- **Documentation.** Architecture decisions go in [DECISIONS.md](DECISIONS.md) (Decision, Context, Options, Chosen approach, Reason, Consequences). Progress updates go in [IMPLEMENTATION.md](IMPLEMENTATION.md).
- **No credentials.** Never commit secrets, `.env` files, private keys, or local databases; `.gitignore` covers `.env*`, `*.pem`, `*.key`, `*.db*`, and logs.

## Before submitting

- `npm run typecheck` passes with zero errors
- Run `node src/cli/index.ts self-test` and `node src/cli/index.ts verify` if possible in your environment
- Describe what changed and why, and reference any DECISIONS.md entries

## Tests

The automated suite (`node --test tests/`) is being built out; see [IMPLEMENTATION.md](IMPLEMENTATION.md) for status. Until it lands, the smoke checks above (`doctor`, `verify`, `self-test`) serve as the regressions gate.