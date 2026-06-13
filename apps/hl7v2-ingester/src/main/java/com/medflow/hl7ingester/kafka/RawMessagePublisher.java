package com.medflow.hl7ingester.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

/**
 * Publishes every received raw HL7v2 message onto the {@code hl7.raw} Kafka topic.
 *
 * <p>The JSON envelope contains {@code messageType}, {@code controlId}, {@code receivedAt},
 * {@code raw} and {@code status}. The {@code raw} field carries the verbatim HL7 message; logs in
 * this class reference only the message control id and type, never PHI segment values.
 */
@Component
public class RawMessagePublisher {

  private static final Logger LOG = LoggerFactory.getLogger(RawMessagePublisher.class);

  private final KafkaTemplate<String, String> kafkaTemplate;
  private final ObjectMapper objectMapper;
  private final String topic;

  /**
   * Creates the publisher.
   *
   * @param kafkaTemplate the template used to publish events
   * @param objectMapper  Jackson mapper for the envelope
   * @param topic         destination topic (defaults to {@code hl7.raw})
   */
  public RawMessagePublisher(
      final KafkaTemplate<String, String> kafkaTemplate,
      final ObjectMapper objectMapper,
      @Value("${kafka.topics.hl7-raw:hl7.raw}") final String topic) {
    this.kafkaTemplate = kafkaTemplate;
    this.objectMapper = objectMapper;
    this.topic = topic;
  }

  /**
   * Publishes a raw HL7v2 message envelope.
   *
   * @param messageType the HL7 message type/trigger, e.g. {@code ADT^A01}
   * @param controlId   the MSH-10 message control id
   * @param raw         the verbatim HL7v2 message
   * @param status      the processing status, e.g. {@code RECEIVED}, {@code PROCESSED},
   *                    {@code PARSE_ERROR}
   */
  public void publish(
      final String messageType, final String controlId, final String raw, final String status) {
    try {
      final ObjectNode envelope = objectMapper.createObjectNode();
      envelope.put("messageType", messageType);
      envelope.put("controlId", controlId);
      envelope.put("receivedAt", Instant.now().toString());
      envelope.put("raw", raw);
      envelope.put("status", status);

      kafkaTemplate.send(topic, controlId, objectMapper.writeValueAsString(envelope));
      LOG.info("Mirrored HL7 message to Kafka messageType={} controlId={} status={}",
          messageType, controlId, status);
    } catch (final Exception ex) {
      LOG.error("Failed to mirror HL7 message to Kafka messageType={} controlId={} status={}",
          messageType, controlId, status, ex);
    }
  }
}
