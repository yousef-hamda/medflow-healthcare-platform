package com.medflow.hl7ingester.config;

import java.util.HashMap;
import java.util.Map;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringSerializer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.core.ProducerFactory;

/**
 * Kafka producer configuration for mirroring raw HL7v2 messages.
 */
@Configuration
public class KafkaConfig {

  private final String bootstrapServers;

  /**
   * Creates the configuration.
   *
   * @param bootstrapServers comma-separated Kafka broker list (from {@code KAFKA_BROKERS})
   */
  public KafkaConfig(@Value("${kafka.brokers}") final String bootstrapServers) {
    this.bootstrapServers = bootstrapServers;
  }

  /**
   * Builds the string-keyed/string-valued producer factory.
   *
   * @return the configured producer factory
   */
  @Bean
  public ProducerFactory<String, String> producerFactory() {
    final Map<String, Object> props = new HashMap<>();
    props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
    props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
    props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
    props.put(ProducerConfig.ACKS_CONFIG, "all");
    return new DefaultKafkaProducerFactory<>(props);
  }

  /**
   * Exposes a {@link KafkaTemplate} for producing raw-message events.
   *
   * @param producerFactory the producer factory
   * @return the Kafka template
   */
  @Bean
  public KafkaTemplate<String, String> kafkaTemplate(
      final ProducerFactory<String, String> producerFactory) {
    return new KafkaTemplate<>(producerFactory);
  }
}
