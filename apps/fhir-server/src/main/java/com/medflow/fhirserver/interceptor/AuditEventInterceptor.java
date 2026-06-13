package com.medflow.fhirserver.interceptor;

import ca.uhn.fhir.interceptor.api.Hook;
import ca.uhn.fhir.interceptor.api.Interceptor;
import ca.uhn.fhir.interceptor.api.Pointcut;
import ca.uhn.fhir.rest.api.RestOperationTypeEnum;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

/**
 * HAPI {@link Interceptor} that emits an audit event to the MedFlow audit service for every server
 * operation.
 *
 * <p>The audit POST is performed asynchronously and non-blocking via {@link WebClient}. Failures
 * degrade gracefully: an audit-service outage never blocks or fails the FHIR request. Only the
 * resource type and id are ever logged.
 */
@Interceptor
@Component
public class AuditEventInterceptor {

  private static final Logger LOG = LoggerFactory.getLogger(AuditEventInterceptor.class);
  private static final Duration TIMEOUT = Duration.ofSeconds(3);

  private final WebClient webClient;
  private final ObjectMapper objectMapper;
  private final String auditServiceUrl;

  /**
   * Creates the interceptor.
   *
   * @param webClient        the reactive client used to call the audit service
   * @param objectMapper     Jackson mapper for the audit payload
   * @param auditServiceUrl  base URL of the audit service (from {@code AUDIT_SERVICE_URL})
   */
  public AuditEventInterceptor(
      final WebClient webClient,
      final ObjectMapper objectMapper,
      @Value("${audit.service.url}") final String auditServiceUrl) {
    this.webClient = webClient;
    this.objectMapper = objectMapper;
    this.auditServiceUrl = auditServiceUrl;
  }

  /**
   * Fires after a successful server operation, posting an audit event.
   *
   * @param requestDetails the HAPI request details for the completed operation
   */
  @Hook(Pointcut.SERVER_PROCESSING_COMPLETED_NORMALLY)
  public void recordAuditEvent(final RequestDetails requestDetails) {
    if (requestDetails == null) {
      return;
    }
    sendAuditEvent(requestDetails);
  }

  /**
   * Builds and posts the audit event, swallowing any errors. Visible for testing.
   *
   * @param requestDetails the request details to derive the event from
   */
  void sendAuditEvent(final RequestDetails requestDetails) {
    final String resourceType = requestDetails.getResourceName();
    final String resourceId =
        requestDetails.getId() != null ? requestDetails.getId().getIdPart() : null;
    final RestOperationTypeEnum operation = requestDetails.getRestOperationType();

    final ObjectNode payload = objectMapper.createObjectNode();
    payload.put("resourceType", resourceType);
    payload.put("resourceId", resourceId);
    payload.put("operation", operation != null ? operation.name() : null);
    payload.put("timestamp", Instant.now().toString());

    try {
      webClient.post()
          .uri(auditServiceUrl + "/audit-events")
          .contentType(MediaType.APPLICATION_JSON)
          .bodyValue(objectMapper.writeValueAsString(payload))
          .retrieve()
          .toBodilessEntity()
          .timeout(TIMEOUT)
          .doOnError(error ->
              LOG.warn("Audit event delivery failed (degrading gracefully) resourceType={} "
                  + "resourceId={}: {}", resourceType, resourceId, error.toString()))
          .onErrorResume(error -> reactor.core.publisher.Mono.empty())
          .subscribe();
    } catch (final Exception ex) {
      // Never let auditing break the FHIR request.
      LOG.warn("Audit event serialization failed (degrading gracefully) resourceType={} "
          + "resourceId={}", resourceType, resourceId);
    }
  }
}
