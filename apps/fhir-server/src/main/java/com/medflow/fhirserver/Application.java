package com.medflow.fhirserver;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration;

/**
 * Entry point for the MedFlow FHIR server.
 *
 * <p>Boots a HAPI FHIR R4 JPA server embedded in Spring Boot. The server exposes the FHIR REST
 * API under {@code /fhir/*}, publishes resource-change events to Kafka and emits SMART
 * configuration metadata. All data handled by this service is synthetic; no real PHI is processed.
 *
 * <p>Spring Boot's {@link HibernateJpaAutoConfiguration} is excluded because the HAPI JPA stack
 * supplies its own {@code EntityManagerFactory} and transaction manager (see
 * {@code com.medflow.fhirserver.config.FhirJpaConfig}).
 */
@SpringBootApplication(exclude = HibernateJpaAutoConfiguration.class)
public class Application {

  /**
   * Standard Spring Boot bootstrap entry point.
   *
   * @param args process command-line arguments forwarded to Spring Boot
   */
  public static void main(final String[] args) {
    SpringApplication.run(Application.class, args);
  }
}
