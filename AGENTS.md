# Forge development rules

- Keep `forge-web`, `forge-api`, and `forge-knowledge` independently buildable. App builds must not invoke sibling build tools or read sibling sources. Root scripts may orchestrate local integration.
- Kotlin follows Kotlin official style: 4 spaces, 100-column target, one statement per line, no semicolon-compressed code. Use braces for multiline control bodies and descriptive business names.
- Run `cd forge-api && ./gradlew formatKotlin` after Kotlin edits and `./gradlew checkKotlinFormat` before handoff. `./gradlew build` includes tests and this format gate.
- Python uses Ruff with 4 spaces and 100 columns. Run `cd forge-knowledge && uv run ruff check . && uv run ruff format --check . && uv run pytest tests -q` for knowledge changes.
- Use the frontend's Prettier rules. Run `cd forge-web && pnpm build && pnpm test` for frontend changes.
- API owns its public OpenAPI and schemas; Python owns internal OpenAPI. Consumers vendor versioned snapshots. Update them explicitly via root `scripts/sync-contracts.py`, never during consumer builds.
- Python owns indexing jobs, payloads, retry and restart recovery. Kotlin only authorizes projects and calls the internal HTTP contract. Never share data directories or SQL tables between services.
- Preserve existing data in this checkout when reorganizing. Do not copy model credentials or `.data` from the original application. Legacy import reads an explicitly configured source and writes only to this project's storage.
- Do not claim live-model, PostgreSQL/pgvector, container, installed-desktop or multi-user verification from fixture tests.
