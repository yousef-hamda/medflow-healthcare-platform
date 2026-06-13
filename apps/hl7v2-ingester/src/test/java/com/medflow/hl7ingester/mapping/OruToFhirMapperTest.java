package com.medflow.hl7ingester.mapping;

import static org.assertj.core.api.Assertions.assertThat;

import ca.uhn.hl7v2.DefaultHapiContext;
import ca.uhn.hl7v2.HapiContext;
import ca.uhn.hl7v2.model.v25.message.ORU_R01;
import com.medflow.hl7ingester.TestMessages;
import com.medflow.hl7ingester.mapping.OruToFhirMapper.MappedReport;
import java.util.List;
import org.hl7.fhir.r4.model.DiagnosticReport;
import org.hl7.fhir.r4.model.Observation;
import org.hl7.fhir.r4.model.Quantity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link OruToFhirMapper} using a synthetic ORU^R01 v2.5 message.
 */
class OruToFhirMapperTest {

  private HapiContext hapiContext;
  private OruToFhirMapper mapper;

  @BeforeEach
  void setUp() {
    hapiContext = new DefaultHapiContext();
    mapper = new OruToFhirMapper();
  }

  @Test
  void mapsObrToDiagnosticReportAndObxToLoincObservations() throws Exception {
    final ORU_R01 oru = (ORU_R01) hapiContext.getPipeParser().parse(TestMessages.ORU_R01);

    final List<MappedReport> reports = mapper.toReports(oru, null);

    assertThat(reports).hasSize(1);
    final MappedReport report = reports.get(0);

    final DiagnosticReport diagnosticReport = report.report();
    assertThat(diagnosticReport.getStatus())
        .isEqualTo(DiagnosticReport.DiagnosticReportStatus.FINAL);
    assertThat(diagnosticReport.getIdentifierFirstRep().getValue()).isEqualTo("FILLER999");
    assertThat(diagnosticReport.getCode().getCodingFirstRep().getSystem())
        .isEqualTo("http://loinc.org");

    assertThat(report.observations()).hasSize(2);

    final Observation glucose = report.observations().get(0);
    assertThat(glucose.getCode().getCodingFirstRep().getSystem()).isEqualTo("http://loinc.org");
    assertThat(glucose.getCode().getCodingFirstRep().getCode()).isEqualTo("2345-7");
    assertThat(glucose.getStatus()).isEqualTo(Observation.ObservationStatus.FINAL);
    final Quantity glucoseValue = glucose.getValueQuantity();
    assertThat(glucoseValue.getValue().doubleValue()).isEqualTo(110.0d);
    assertThat(glucoseValue.getUnit()).isEqualTo("mg/dL");

    final Observation creatinine = report.observations().get(1);
    assertThat(creatinine.getCode().getCodingFirstRep().getCode()).isEqualTo("2160-0");
    assertThat(creatinine.getValueQuantity().getValue().doubleValue()).isEqualTo(0.9d);
  }
}
