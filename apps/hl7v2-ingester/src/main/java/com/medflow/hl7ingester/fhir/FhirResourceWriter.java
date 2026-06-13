package com.medflow.hl7ingester.fhir;

import ca.uhn.fhir.rest.client.api.IGenericClient;
import org.hl7.fhir.instance.model.api.IBaseResource;
import org.hl7.fhir.r4.model.Encounter;
import org.hl7.fhir.r4.model.Identifier;
import org.hl7.fhir.r4.model.Observation;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.ServiceRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Persists mapped FHIR resources to the MedFlow FHIR server using identifier-based
 * conditional create, so that re-sent HL7 messages do not create duplicates.
 *
 * <p>Only resource type and id are logged — identifier <em>values</em> (which are PHI, e.g. MRN)
 * are never written to logs.
 */
@Component
public class FhirResourceWriter {

  private static final Logger LOG = LoggerFactory.getLogger(FhirResourceWriter.class);

  private final IGenericClient fhirClient;

  /**
   * Creates the writer.
   *
   * @param fhirClient the FHIR REST client targeting the MedFlow FHIR server
   */
  public FhirResourceWriter(final IGenericClient fhirClient) {
    this.fhirClient = fhirClient;
  }

  /**
   * Conditionally creates a resource keyed on its first business identifier.
   *
   * <p>When the resource carries an identifier the operation is a conditional create
   * ({@code If-None-Exist}); otherwise a plain create is performed.
   *
   * @param resource the FHIR resource to persist
   * @return the id assigned by the server, or {@code null} if creation produced no id
   */
  public String conditionalCreate(final IBaseResource resource) {
    final Identifier identifier = firstIdentifier(resource);
    final var execution = fhirClient.create().resource(resource);

    if (identifier != null && identifier.getSystem() != null && identifier.getValue() != null) {
      execution.conditional()
          .where(Patient.IDENTIFIER.exactly()
              .systemAndIdentifier(identifier.getSystem(), identifier.getValue()));
    }

    final var outcome = execution.execute();
    final String idPart =
        outcome.getId() != null ? outcome.getId().getIdPart() : null;
    LOG.info("Persisted FHIR resource resourceType={} resourceId={}",
        resource.fhirType(), idPart);
    return idPart;
  }

  /**
   * Returns the first business identifier of a supported resource type, if present.
   *
   * @param resource the resource to inspect
   * @return the first identifier or {@code null}
   */
  private Identifier firstIdentifier(final IBaseResource resource) {
    if (resource instanceof Patient patient && !patient.getIdentifier().isEmpty()) {
      return patient.getIdentifierFirstRep();
    }
    if (resource instanceof Encounter encounter && !encounter.getIdentifier().isEmpty()) {
      return encounter.getIdentifierFirstRep();
    }
    if (resource instanceof Observation observation && !observation.getIdentifier().isEmpty()) {
      return observation.getIdentifierFirstRep();
    }
    if (resource instanceof ServiceRequest request && !request.getIdentifier().isEmpty()) {
      return request.getIdentifierFirstRep();
    }
    return null;
  }
}
