{{/*
Common template helpers for the medflow chart.
*/}}

{{/*
Chart name (allows nameOverride).
*/}}
{{- define "medflow.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Chart name + version, used in the helm.sh/chart label.
*/}}
{{- define "medflow.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Effective image tag: .Values.global.imageTag, falling back to appVersion.
*/}}
{{- define "medflow.imageTag" -}}
{{- default .Chart.AppVersion .Values.global.imageTag -}}
{{- end -}}

{{/*
Common (non-selector) labels. Expects the root context.
*/}}
{{- define "medflow.labels" -}}
helm.sh/chart: {{ include "medflow.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: medflow
app.kubernetes.io/version: {{ include "medflow.imageTag" . | quote }}
{{- end -}}

{{/*
Selector labels for one service.
Expects a dict: (dict "root" $ "name" <service-name>).
Keep this list stable — it is used in Deployment selectors, which are immutable.
*/}}
{{- define "medflow.selectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{/*
Fully-qualified image reference for one service.
Expects a dict: (dict "root" $ "name" <service-name>).
*/}}
{{- define "medflow.image" -}}
{{- printf "%s/%s:%s" .root.Values.global.imageRegistry .name (include "medflow.imageTag" .root) -}}
{{- end -}}
