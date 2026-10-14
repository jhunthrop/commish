# research/Dockerfile. The build context is research/, with web/ as the named context `web` (the run
# contract the nightly's schema gate reads):
#   docker build --build-context web=web --build-arg VERSION=$(git rev-parse --short=8 HEAD) \
#     -f research/Dockerfile -t commish-research:local research
#
# One image, three modules, each run with `python -m`:
#   research.advisor                    the advisor service (the default CMD), POST /advise on $PORT
#   research.nightly run | publish      the Cloud Run Jobs `nightly` and `nightly-publish`
#   research.inseason --task <task>     the Cloud Run Jobs `inseason` (season-week) and `inseason-capture`
# The jobs pass the module and its arguments as their args. The deploy builds once and points the
# service and every job at the same digest.
#
# `research/` is both the uv project and the importable package `research` (pyproject.toml), so it
# is copied to /app/research and /app is what puts `research` on the path.
# THE WEB'S RUN CONTRACT (the nightly's `schema` gate, `nightly/schema_gate.py`): the web's own
# schema and reader, copied from the repository, with zod and aws4fetch at the versions the web's lock
# pins, under node. A run the web build would refuse never moves a pointer.
FROM node:24-slim AS web-contract
WORKDIR /contract
COPY --from=web package-lock.json /tmp/web-lock.json
RUN node -e 'const lock = require("/tmp/web-lock.json").packages; \
  const pin = (name) => lock["node_modules/" + name].version; \
  const manifest = { name: "web-contract", private: true, type: "module", imports: { "#lib/*": "./src/lib/*" }, \
    dependencies: { zod: pin("zod"), aws4fetch: pin("aws4fetch") } }; \
  require("fs").writeFileSync("package.json", JSON.stringify(manifest, null, 2));' \
  && npm install --omit=dev --no-audit --no-fund --ignore-scripts
COPY --from=web src/lib/run ./src/lib/run
COPY --from=web src/lib/types/player.ts ./src/lib/types/player.ts
# The build's own reader, which the gate drives so that its cross-file checks are the web's, not a copy.
COPY --from=web src/lib/server/run.ts ./src/lib/server/run.ts

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
ENV RESEARCH_MODEL_COMMIT=${VERSION} PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    WEB_CONTRACT_DIR=/app/web-contract
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --no-create-home research
COPY --from=web-contract /usr/local/bin/node /usr/local/bin/node
COPY --from=web-contract /contract /app/web-contract
COPY --from=build /app /app
WORKDIR /app/research
USER 10001
EXPOSE 8080
ENTRYPOINT ["python", "-m"]
CMD ["research.advisor"]
