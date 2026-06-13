package com.medflow.hl7ingester.mapping;

import ca.uhn.hl7v2.HL7Exception;
import ca.uhn.hl7v2.model.v25.group.ORM_O01_ORDER;
import ca.uhn.hl7v2.model.v25.message.ORM_O01;
import ca.uhn.hl7v2.model.v25.segment.OBR;
import ca.uhn.hl7v2.model.v25.segment.ORC;
import java.util.ArrayList;
import java.util.List;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.ServiceRequest;
import org.springframework.stereotype.Component;

/**
 * Maps HL7v2 ORM^O01 order messages to FHIR R4 {@link ServiceRequest} resources.
 *
 * <p>Each ORDER group (ORC paired with its OBR) becomes one ServiceRequest. The ORC order-control
 * code drives the request status; the OBR universal-service identifier becomes the request code.
 */
@Component
public class OrmToFhirMapper {

  private static final String PLACER_SYSTEM = "urn:medflow:placer-order-number";

  /**
   * Maps every ORDER group of an ORM^O01 message to a {@link ServiceRequest}.
   *
   * @param orm        the parsed ORM^O01 message
   * @param patientRef a reference to the subject Patient (may be {@code null})
   * @return one ServiceRequest per ORDER group
   * @throws HL7Exception if required fields cannot be read
   */
  public List<ServiceRequest> toServiceRequests(final ORM_O01 orm, final Reference patientRef)
      throws HL7Exception {
    final List<ServiceRequest> requests = new ArrayList<>();

    for (int i = 0; i < orm.getORDERReps(); i++) {
      final ORM_O01_ORDER order = orm.getORDER(i);
      final ORC orc = order.getORC();
      final OBR obr = order.getORDER_DETAIL().getOBR();

      final ServiceRequest request = new ServiceRequest();
      request.setStatus(mapStatus(value(orc.getOrderControl().getValue())));
      request.setIntent(ServiceRequest.ServiceRequestIntent.ORDER);

      final String placer = value(orc.getPlacerOrderNumber().getEntityIdentifier().getValue());
      if (placer != null) {
        request.addIdentifier().setSystem(PLACER_SYSTEM).setValue(placer);
      }

      request.setCode(codeFromObr(obr));

      if (patientRef != null) {
        request.setSubject(patientRef);
      }
      requests.add(request);
    }
    return requests;
  }

  private CodeableConcept codeFromObr(final OBR obr) throws HL7Exception {
    final CodeableConcept concept = new CodeableConcept();
    final Coding coding = concept.addCoding();
    final String code = value(obr.getUniversalServiceIdentifier().getIdentifier().getValue());
    final String display = value(obr.getUniversalServiceIdentifier().getText().getValue());
    final String system = value(obr.getUniversalServiceIdentifier().getNameOfCodingSystem().getValue());
    if ("LN".equalsIgnoreCase(system) || "LOINC".equalsIgnoreCase(system)) {
      coding.setSystem("http://loinc.org");
    } else if (system != null) {
      coding.setSystem("urn:medflow:coding:" + system);
    }
    coding.setCode(code);
    coding.setDisplay(display);
    if (display != null) {
      concept.setText(display);
    }
    return concept;
  }

  private ServiceRequest.ServiceRequestStatus mapStatus(final String orderControl) {
    if (orderControl == null) {
      return ServiceRequest.ServiceRequestStatus.ACTIVE;
    }
    return switch (orderControl.toUpperCase()) {
      case "NW", "XO" -> ServiceRequest.ServiceRequestStatus.ACTIVE;
      case "CA", "OC" -> ServiceRequest.ServiceRequestStatus.REVOKED;
      case "CM" -> ServiceRequest.ServiceRequestStatus.COMPLETED;
      case "HD" -> ServiceRequest.ServiceRequestStatus.ONHOLD;
      default -> ServiceRequest.ServiceRequestStatus.ACTIVE;
    };
  }

  private String value(final String raw) {
    return raw == null || raw.isBlank() ? null : raw;
  }
}
