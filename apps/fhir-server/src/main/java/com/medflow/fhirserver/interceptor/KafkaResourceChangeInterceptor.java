package com.medflow.fhirserver.interceptor;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.interceptor.api.Hook;
import ca.uhn.fhir.interceptor.api.Interceptor;
import ca.uhn.fhir.interceptor.api.Pointcut;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import org.hl7.fhir.instance.model.api.IBaseResource;
import org.hl7.fhir.instance.model.api.IIdType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

/**
 * HAPI {@link Interceptor} that publishes a change event to Kafka whenever a FHIR resource is
 * created, updated or deleted.
 *
 * <p>The published JSON payload contains {@code resourceType}, {@code resourceId},
 * {@code versionId}, {@code operation}, {@code timestamp} and the serialized {@code resource}.
 * Log statements emitted by this interceptor deliberately contain only the resource type and id
 * so that no PHI (names, MRN, DOB, phone, address) is ever written to logs.
 */
@Interceptor
@Component
public class KafkaResourceChangeInterceptor {

  private static final Logger LOG = LoggerFactory.getLogger(KafkaResourceChangeInterceptor.class);

  private final KafkaTemplate<String, String> kafkaTemplate;
  private final FhirContext fhirContext;
  private final ObjectMapper objectMapper;
  private final String topic;

  /**
   * Creates the interceptor.
   *
   * @param kafkaTemplate the template used to publish events
   * @param fhirContext   the FHIR context used to serialize resources
   * @param objectMapper  Jackson mapper for the envelope
   * @param topic         the destination topic (defaults to {@code fhir.changes})
   */
  public KafkaResourceChangeInterceptor(
      final KafkaTemplate<String, String> kafkaTemplate,
      final FhirContext fhirContext,
      final ObjectMapper objectMapper,
      @Value("${kafka.topics.fhir-changes:fhir.changes}") final String topic) {
    this.kafkaTemplate = kafkaTemplate;
    this.fhirContext = fhirContext;
    this.objectMapper = objectMapper;
    this.topic = topic;
  }

  /**
   * Handles newly created resources.
   *
   * @param resource the created resource
   */
  @Hook(Pointcut.STORAGE_PRECOMMIT_RESOURCE_CREATED)
  public void resourceCreated(final IBaseResource resource) {
    publish(resource, "CREATE");
  }

  /**
   * Handles updated resources.
   *
   * @param previousResource the resource state before the update (unused)
   * @param resource         the updated resource
   */
  @Hook(Pointcut.STORAGE_PRECOMMIT_RESOURCE_UPDATED)
  public void resourceUpdated(final IBaseResource previousResource, final IBaseResource resource) {
    publish(resource, "UPDATE");
  }

  /**
   * Handles deleted resources.
   *
   * @param resource the deleted resource
   */
  @Hook(Pointcut.STORAGE_PRECOMMIT_RESOURCE_DELETED)
  public void resourceDeleted(final IBaseResource resource) {
    publish(resource, "DELETE");
  }

  /**
   * Builds the change envelope and publishes it. Visible for testing.
   *
   * @param resource  the affected resource
   * @param operation one of {@code CREATE}, {@code UPDATE} or {@code DELETE}
   */
  void publish(final IBaseResource resource, final String operation) {
    if (resource == null) {
      return;
    }
    final IIdType id = resource.getIdElement();
    final String resourceType = id != null ? id.getResourceType() : resource.fhirType();
    final String resourceId = id != null ? id.getIdPart() : null;
    final String versionId = id != null ? id.getVersionIdPart() : null;

    try {
      final ObjectNode envelope = objectMapper.createObjectNode();
      envelope.put("resourceType", resourceType);
      envelope.put("resourceId", resourceId);
      envelope.put("versionId", versionId);
      envelope.put("operation", operation);
      envelope.put("timestamp", Instant.now().toString());

      final String resourceJson =
          fhirContext.newJsonParser().encodeResourceToString(resource);
      envelope.set("resource", objectMapper.readTree(resourceJson));

      final String key = resourceType + "/" + resourceId;
      kafkaTemplate.send(topic, key, objectMapper.writeValueAsString(envelope));

      // PHI-safe: only resource type and id are logged.
      LOG.info("Published FHIR change event operation={} resourceType={} resourceId={}",
          operation, resourceType, resourceId);
    } catch (final Exception ex) {
      LOG.error("Failed to publish FHIR change event operation={} resourceType={} resourceId={}",
          operation, resourceType, resourceId, ex);
    }
  }
}
