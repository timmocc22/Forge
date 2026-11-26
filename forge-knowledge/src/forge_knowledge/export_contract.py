"""Export the producer's versioned API without starting workers or calling models."""

import json
import sys
import tempfile
from pathlib import Path

from .app import create_app
from .models import Settings


def main():
    output = Path(sys.argv[1] if len(sys.argv) > 1 else "contracts/openapi.v1.json")
    with tempfile.TemporaryDirectory() as directory:
        app = create_app(
            Settings(token="contract-export-only", database_url=f"sqlite:///{directory}/export.db")
        )
        try:
            spec = app.openapi()
        finally:
            app.state.store.engine.dispose()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n")
    print(f"Exported {output}")


if __name__ == "__main__":
    main()
