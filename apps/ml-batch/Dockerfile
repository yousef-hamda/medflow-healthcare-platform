# syntax=docker/dockerfile:1.7
# ---------- build stage: resolve and wheel all dependencies ----------
FROM python:3.11-slim AS build

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Torch CPU wheels keep the image an order of magnitude smaller; the GPU
# wheels are only needed for the chest X-ray job on accelerated hosts.
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu .

# ---------- runtime stage ----------
FROM python:3.11-slim AS runtime

# NOTE: the PySpark jobs run as a Spark *client* (driver) that submits to the
# external spark-master defined in docker-compose.yml. A JRE/JDK is required
# on the client even though the heavy lifting happens on the workers, so we
# install a headless JDK and expose JAVA_HOME for the Spark launcher.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64" \
    PYSPARK_PYTHON="/opt/venv/bin/python" \
    PYSPARK_DRIVER_PYTHON="/opt/venv/bin/python"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgomp1 \
        curl \
        openjdk-17-jdk-headless \
        procps \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system medflow \
    && useradd --system --gid medflow --create-home medflow

COPY --from=build /opt/venv /opt/venv

USER medflow
WORKDIR /home/medflow

# Batch jobs are invoked explicitly, e.g.
#   docker compose run --rm ml-batch python -m medflow_ml.jobs.train_sepsis
# so the default command just prints the available entrypoints.
CMD ["python", "-c", "import medflow_ml; print('medflow-ml batch image ready; run a job with python -m medflow_ml.jobs.<job>')"]
