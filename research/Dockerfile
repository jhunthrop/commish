# research/Dockerfile. The build context is research/:
#   docker build --build-arg VERSION=$(git rev-parse --short=8 HEAD) -t commish-research:local research
#
# One image, two commands, each a module run with `python -m`:
#   research.advisor   the advisor service (the default CMD), POST /advise on $PORT
#   research.nightly   the nightly run (the Cloud Run Job passes it as its argument)
# The deploy builds once and points the service and the job at the same digest.
#
# `research/` is both the uv project and the importable package `research` (pyproject.toml), so it
# is copied to /app/research and /app is what puts `research` on the path.
FROM python:3.13-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.12.23 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app/research
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project --no-cache
COPY . .
RUN uv sync --frozen --no-dev --no-cache

FROM python:3.13-slim
ARG VERSION=dev
# The model version every board and freeze records (`research.model.arithmetic.model_version`):
# there is no git in the image, so the commit comes in at build time.
ENV RESEARCH_MODEL_COMMIT=${VERSION} PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN useradd --system --uid 10001 --no-create-home research
COPY --from=build /app /app
WORKDIR /app/research
USER 10001
EXPOSE 8080
ENTRYPOINT ["python", "-m"]
CMD ["research.advisor"]
