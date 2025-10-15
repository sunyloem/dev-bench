# Repository Guidelines

## Project Structure & Module Organization
- `bin/mcp-assets-creator.js` bootstraps the CLI entry point and hands arguments to `src/main.js`.
- `src/main.js` hosts the Local MCP server, tool registry, and Gemini client wrapper; keep new logic modular so each tool handler stays focused.
- Keep shared utilities under `src/lib/` (create as needed) and maintain automated checks under `tests/` to avoid cluttering the root.

## Build, Test, and Development Commands
- `npm start` launches the CLI with Node 18+, expecting `GOOGLE_API_KEY` to be exported.
- `node bin/mcp-assets-creator.js --help` lists supported flags for quick validation.
- `npm run lint` lints `src`, `bin`, and `tests` with ESLint’s recommended rules.
- `npm test` executes Node’s built-in test runner across the `tests/` directory.

## Coding Style & Naming Conventions
- Follow the existing ES module setup, using `import`/`export` and async/await for I/O boundaries.
- Keep two-space indentation, trailing commas in multi-line objects, and reserve single quotes for shell-facing strings.
- Tool identifiers stay `snake_case` to align with the current protocol; classes use `PascalCase`, helpers use `camelCase`.
- Prefer small functions in `src/main.js` so error handling stays explicit and MCP responses remain actionable.

## Testing Guidelines
- Add unit and integration tests under `tests/`, mirroring the source structure (e.g., `tests/main.test.js` for `src/main.js`).
- Use Node’s built-in test runner via `npm test`; introduce Vitest only if richer assertions become necessary and document those changes.
- For Gemini-dependent paths, isolate network calls behind mocks or adapters so tests stay deterministic and sandbox-safe.
- Target 80% line coverage before merging substantial features; call out gaps when that is not achievable.

## Commit & Pull Request Guidelines
- Use Conventional Commits (`feat:`, `fix:`, `chore:`) so release tooling can infer change semantics even while the history is young.
- Keep commits scoped to one concern and describe the user-facing impact in the body when it is not obvious from the subject.
- Pull requests must include: a concise summary, test evidence or rationale for skipping tests, linked issues/task IDs, and screenshots or CLI transcripts when behavior changes.

## Configuration & Security Tips
- Never commit real API keys; rely on `.env` files excluded via `.gitignore` and reference variables like `GOOGLE_API_KEY` in docs instead.
- When developing with debug output enabled, inspect logs before sharing to ensure Gemini prompts or generated assets do not leak sensitive material.
