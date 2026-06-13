# syntax=docker/dockerfile:1.7
# ---------- build stage: resolve and wheel all dependencies ----------
FROM python:3.14-slim AS build

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Torch CPU wheels keep the image an order of magnitude smaller.
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu .

# ---------- runtime stage ----------
FROM python:3.14-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system medflow \
    && useradd --system --gid medflow --create-home medflow

COPY --from=build /opt/venv /opt/venv

USER medflow
WORKDIR /home/medflow

EXPOSE 8094
HEALTHCHECK --interval=15s --timeout=5s --retries=10 \
    CMD curl -sf "http://localhost:${HTTP_PORT:-8094}/healthz" || exit 1

CMD ["python", "-m", "medflow_serving.main"]
