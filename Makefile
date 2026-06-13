# MedFlow — Scalable Healthcare Data Platform
# All data is synthetic (Synthea). No real PHI is ever used.

SHELL := /bin/bash
COMPOSE := docker compose
COMPOSE_DEV := docker compose -f docker-compose.yml -f docker-compose.dev.yml
N ?= 500

.DEFAULT_GOAL := help

.PHONY: help dev dev-build down logs ps clean \
	seed-patients sim-hl7 sim-dicom sim-vitals \
	airflow spark trino superset flink lineage \
	train-sepsis train-readmission train-xray download-chestxray \
	compliance-report audit-query \
	k8s-up k8s-down scan sbom lint test fmt e2e

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}'

## ── Local development ────────────────────────────────────────────────────────

dev: ## Bring up the full stack with hot reload (first run takes a few minutes)
	$(COMPOSE_DEV) up -d --build
	@echo ""
	@echo "MedFlow is starting. Key endpoints:"
	@echo "  Clinician dashboard  http://localhost:3000"
	@echo "  Patient portal       http://localhost:3001"
	@echo "  API gateway          http://localhost:4000  (Swagger at /docs, GraphQL at /graphql)"
	@echo "  FHIR server          http://localhost:8090/fhir"
	@echo "  ML serving           http://localhost:8094/docs"
	@echo "  Airflow              http://localhost:8080  (admin/admin)"
	@echo "  MLflow               http://localhost:5000"
	@echo "  MinIO console        http://localhost:9001  (minio_admin/minio_dev_password)"
	@echo "  Grafana              http://localhost:3002  (admin/admin)"
	@echo "  Superset             http://localhost:8088  (admin/admin)"
	@echo "  Marquez lineage      http://localhost:3003"
	@echo ""
	@echo "Next: make seed-patients N=500"

dev-build: ## Rebuild all images
	$(COMPOSE_DEV) build

down: ## Stop the stack (keeps volumes)
	$(COMPOSE) down

logs: ## Tail logs (S=service to filter)
	$(COMPOSE) logs -f $(S)

ps: ## Show running services
	$(COMPOSE) ps

clean: ## Stop the stack and remove volumes (DESTROYS local data)
	$(COMPOSE) down -v --remove-orphans
	rm -rf .volumes

## ── Synthetic data & simulators ──────────────────────────────────────────────

seed-patients: ## Generate N Synthea patients and load them into the FHIR server (default N=500)
	./scripts/seed_patients.sh $(N)

sim-hl7: ## Replay HL7v2 ADT/ORU/ORM messages over MLLP
	python3 scripts/simulators/hl7_replay.py --host localhost --port 2575 \
		--file scripts/simulators/data/hl7_messages.csv --rate $(or $(RATE),5)

sim-dicom: ## Push sample chest X-rays via DICOM C-STORE
	python3 scripts/simulators/dicom_push.py --host localhost --port 11112

sim-vitals: ## Stream synthetic vitals over MQTT (includes patients trending toward sepsis)
	python3 scripts/simulators/vitals_stream.py --broker localhost --port 1883

## ── Analytics stack shortcuts ────────────────────────────────────────────────

airflow: ## Bring up Airflow (webserver + scheduler + deps)
	$(COMPOSE) up -d airflow-webserver airflow-scheduler

spark: ## Bring up the Spark cluster
	$(COMPOSE) up -d spark-master spark-worker

trino: ## Bring up Trino
	$(COMPOSE) up -d trino

superset: ## Bring up Superset BI
	$(COMPOSE) up -d superset

flink: ## Bring up Flink and submit the sepsis streaming job
	$(COMPOSE) up -d flink-jobmanager flink-taskmanager
	./scripts/submit_flink_job.sh

lineage: ## Bring up Marquez lineage UI
	$(COMPOSE) up -d marquez marquez-web

## ── ML training ──────────────────────────────────────────────────────────────

train-sepsis: ## Train the sepsis LSTM (logs to MLflow)
	$(COMPOSE) run --rm ml-batch python -m medflow_ml.jobs.train_sepsis

train-readmission: ## Train the 30-day readmission XGBoost model
	$(COMPOSE) run --rm ml-batch python -m medflow_ml.jobs.train_readmission

train-xray: ## Fine-tune DenseNet121 on the local ChestX-ray14 slice
	$(COMPOSE) run --rm ml-batch python -m medflow_ml.jobs.train_xray

download-chestxray: ## Download a small NIH ChestX-ray14 slice (research-use-only license)
	./scripts/download_chestxray.sh

## ── Compliance & audit ───────────────────────────────────────────────────────

compliance-report: ## Generate the compliance posture report (encryption, audit chain, scan status)
	./scripts/compliance_report.sh

audit-query: ## Run example audit-review queries against the audit log
	./scripts/audit_query.sh

## ── Kubernetes ───────────────────────────────────────────────────────────────

k8s-up: ## Deploy the Helm chart to the current kube context (kind/minikube friendly)
	helm upgrade --install medflow infra/helm/medflow \
		--namespace medflow --create-namespace \
		--values infra/helm/medflow/values-local.yaml

k8s-down: ## Remove the Helm release
	helm uninstall medflow --namespace medflow || true

## ── Quality & security ───────────────────────────────────────────────────────

scan: ## Trivy-scan all service images (fails on HIGH/CRITICAL)
	./scripts/scan.sh

sbom: ## Generate SBOMs (Syft) for all service images
	./scripts/sbom.sh

lint: ## Lint everything (TS + Python + YAML)
	pnpm lint
	ruff check apps/dicom-receiver apps/wearables-ingester apps/deid-service apps/ml-serving apps/ml-batch ml data scripts

test: ## Run all unit tests
	pnpm test
	./scripts/test_python.sh

fmt: ## Format everything
	pnpm format
	black apps/dicom-receiver apps/wearables-ingester apps/deid-service apps/ml-serving apps/ml-batch ml data scripts

e2e: ## Run Playwright E2E suites (stack must be up and seeded)
	pnpm --filter clinician-dashboard e2e
	pnpm --filter patient-portal e2e
