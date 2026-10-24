# research/Dockerfile. The build context is research/, with web/, api/ and shared/ as the named contexts
# `web`, `api` and `shared` (the run contract the nightly's schema gate reads, the API's words file it
# imports, and the site's banned list the writer reads):
#   docker build --build-context web=web --build-context api=api --build-context shared=shared \
#     --build-arg VERSION=$(git rev-parse --short=8 HEAD) -f research/Dockerfile -t commish-research:local research
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
# The stage mirrors the repository's layout, /contract/web beside /contract/api, so the reader's
# relative imports resolve as they do in the tree (`src/lib/format/figure-words.ts` reads
# `../../../../api/internal/figurewords/words.json`). Every runtime import of the reader is one of the
# copies below: web/src/lib/run/image-closure.test.ts walks the closure against these COPY lines and
# pins, so an import the image lacks fails the web's tests, not the image job (Lane 76).
# The writer reads the site's one banned list beside the copy, where the repository holds it
# (shared/words/banned-words.json, the named context `shared`, research/capsules/site_words.py through
# research/web_contract.py).
FROM node:24-slim AS web-contract
WORKDIR /contract/web
COPY --from=web package-lock.json /tmp/web-lock.json
RUN node -e 'const lock = require("/tmp/web-lock.json").packages; \
  const pin = (name) => lock["node_modules/" + name].version; \
  const manifest = { name: "web-contract", private: true, type: "module", imports: { "#lib/*": "./src/lib/*" }, \
    dependencies: { zod: pin("zod"), aws4fetch: pin("aws4fetch") } }; \
  require("fs").writeFileSync("package.json", JSON.stringify(manifest, null, 2));' \
  && npm install --omit=dev --no-audit --no-fund --ignore-scripts
COPY --from=web src/lib/run ./src/lib/run
COPY --from=web src/lib/format ./src/lib/format
COPY --from=web src/lib/types/player.ts ./src/lib/types/player.ts
COPY --from=api internal/figurewords/words.json ../api/internal/figurewords/words.json
COPY --from=shared words/banned-words.json ../shared/words/banned-words.json
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
    WEB_CONTRACT_DIR=/app/contract/web
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --no-create-home research
COPY --from=web-contract /usr/local/bin/node /usr/local/bin/node
COPY --from=web-contract /contract /app/contract
COPY --from=build /app /app
WORKDIR /app/research
USER 10001
EXPOSE 8080
ENTRYPOINT ["python", "-m"]
CMD ["research.advisor"]
