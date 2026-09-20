# Tests for skillrouter

Run the suite:

```bash
npm test                # full suite
npm run test:unit       # unit tests only
npm run test:router     # router integration tests
npm run typecheck       # TypeScript type checking
```

## Layout

- `tests/adapters/` — adapter contract tests (each LLM provider)
- `tests/benchmark/` — performance and latency benchmarks
- `tests/classification/` — task-classification and routing-logic tests
- `tests/cli/` — command-line surface tests

## Conventions

- Tests use the project's existing test runner (see `package.json`).
- Adapter tests that need real API keys should `skip` when the key is absent
  rather than fail.
- Benchmark tests are tagged so they can be excluded from the fast path.
