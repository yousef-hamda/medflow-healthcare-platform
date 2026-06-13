package com.medflow.hl7ingester.config;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.client.api.IGenericClient;
import ca.uhn.hl7v2.DefaultHapiContext;
import ca.uhn.hl7v2.HapiContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Provides shared HAPI HL7v2 and HAPI FHIR beans.
 */
@Configuration
public class HapiConfig {

  /**
   * Builds the shared HL7v2 {@link HapiContext} used for parsing and ACK generation.
   *
   * @return the HL7v2 context
   */
  @Bean
  public HapiContext hapiContext() {
    return new DefaultHapiContext();
  }

  /**
   * Builds the shared R4 {@link FhirContext}.
   *
   * @return the FHIR R4 context
   */
  @Bean
  public FhirContext fhirContext() {
    return FhirContext.forR4();
  }

  /**
   * Builds the FHIR REST client pointed at the MedFlow FHIR server.
   *
   * @param fhirContext the FHIR context
   * @param fhirBaseUrl the FHIR server base URL (from {@code FHIR_BASE_URL})
   * @return a configured generic FHIR client
   */
  @Bean
  public IGenericClient fhirClient(
      final FhirContext fhirContext,
      @Value("${fhir.base-url}") final String fhirBaseUrl) {
    return fhirContext.newRestfulGenericClient(fhirBaseUrl);
  }
}
