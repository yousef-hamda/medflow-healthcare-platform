# ---- build stage -----------------------------------------------------------
FROM python:3.14-slim AS builder

WORKDIR /build
COPY pyproject.toml README.md ./
COPY src ./src

# Install into an isolated prefix so the runtime image only gets site-packages.
RUN pip install --no-cache-dir --prefix=/install .

# ---- runtime stage ----------------------------------------------------------
FROM python:3.14-slim

LABEL org.opencontainers.image.title="medflow-wearables-ingester" \
      org.opencontainers.image.description="Wearables vitals ingester: MQTT + HTTP intake, Postgres persistence, Kafka fan-out"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN useradd --system --uid 10001 --no-create-home medflow

COPY --from=builder /install /usr/local

# Migrations ship with the image so `alembic upgrade head` can run in-container.
WORKDIR /app
COPY alembic.ini ./
COPY alembic ./alembic

USER medflow
EXPOSE 8092

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD ["python", "-c", "import os,urllib.request;urllib.request.urlopen(f\"http://localhost:{os.environ.get('HTTP_PORT','8092')}/healthz\", timeout=3)"]

CMD ["uvicorn", "medflow_wearables.main:app", "--host", "0.0.0.0", "--port", "8092"]
