.PHONY: dev start check contracts e2e
dev:
	./scripts/dev.sh
start:
	./scripts/start.sh
check:
	./scripts/test.sh
	python3 scripts/check-boundaries.py
contracts:
	cd forge-knowledge && uv run python -m forge_knowledge.export_contract
	python3 scripts/sync-contracts.py
	cd forge-web && pnpm api:generate
e2e:
	./scripts/test.sh e2e
