# ---- build stage -----------------------------------------------------------
FROM python:3.11-slim AS builder

WORKDIR /build
COPY pyproject.toml README.md ./
COPY src ./src

# Install into an isolated prefix so the runtime image only gets site-packages.
RUN pip install --no-cache-dir --prefix=/install .

# ---- runtime stage ----------------------------------------------------------
FROM python:3.11-slim

LABEL org.opencontainers.image.title="medflow-dicom-receiver" \
      org.opencontainers.image.description="DICOM C-STORE/C-ECHO SCP with MinIO, FHIR and Kafka integration"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN useradd --system --uid 10001 --no-create-home medflow

COPY --from=builder /install /usr/local

USER medflow
EXPOSE 11112 8091

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD ["python", "-c", "import os,urllib.request;urllib.request.urlopen(f\"http://localhost:{os.environ.get('HTTP_PORT','8091')}/healthz\", timeout=3)"]

CMD ["python", "-m", "medflow_dicom.main"]
