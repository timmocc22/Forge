FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
COPY src ./src
RUN uv sync --frozen --no-dev
ENV KNOWLEDGE_DATABASE_URL=sqlite:////app/data/knowledge.db
EXPOSE 3017
CMD ["uv", "run", "--no-sync", "uvicorn", "forge_knowledge.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "3017"]
