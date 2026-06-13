package com.medflow.hl7ingester;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Entry point for the MedFlow HL7v2 ingester.
 *
 * <p>Starts an MLLP listener that accepts HL7 v2.5 messages (ADT, ORU, ORM), maps them to FHIR R4
 * resources, persists them in the MedFlow FHIR server and mirrors the raw messages onto a Kafka
 * topic. All processed data is synthetic; no real PHI is handled and PHI values are never logged.
 */
@SpringBootApplication
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
