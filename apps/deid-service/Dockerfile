# ---- build stage -----------------------------------------------------------
FROM python:3.11-slim AS builder

WORKDIR /build
COPY pyproject.toml README.md ./
COPY src ./src

# Install into an isolated prefix so the runtime image only gets site-packages.
RUN pip install --no-cache-dir --prefix=/install .

# ---- runtime stage ----------------------------------------------------------
FROM python:3.11-slim

LABEL org.opencontainers.image.title="medflow-deid-service" \
      org.opencontainers.image.description="HIPAA Safe Harbor de-identification: free-text + FHIR (Presidio + custom rules)"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HTTP_PORT=8093

RUN useradd --system --uid 10001 --no-create-home medflow

COPY --from=builder /install /usr/local

WORKDIR /app

USER medflow
EXPOSE 8093

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD ["python", "-c", "import os,urllib.request;urllib.request.urlopen(f\"http://localhost:{os.environ.get('HTTP_PORT','8093')}/healthz\", timeout=3)"]

CMD ["uvicorn", "medflow_deid.main:app", "--host", "0.0.0.0", "--port", "8093"]
