package com.medflow.hl7ingester.mllp;

import static org.assertj.core.api.Assertions.assertThat;

import ca.uhn.hl7v2.AcknowledgmentCode;
import ca.uhn.hl7v2.DefaultHapiContext;
import ca.uhn.hl7v2.HL7Exception;
import ca.uhn.hl7v2.HapiContext;
import ca.uhn.hl7v2.model.Message;
import ca.uhn.hl7v2.model.v25.segment.MSA;
import com.medflow.hl7ingester.TestMessages;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Verifies HL7v2 application ACK (AA) and NAK (AE) generation.
 */
class AcknowledgementTest {

  private HapiContext hapiContext;

  @BeforeEach
  void setUp() {
    hapiContext = new DefaultHapiContext();
  }

  @Test
  void generatesPositiveAcknowledgement() throws Exception {
    final Message message = hapiContext.getPipeParser().parse(TestMessages.ADT_A01);

    final Message ack = message.generateACK();

    final MSA msa = (MSA) ack.get("MSA");
    assertThat(msa.getAcknowledgmentCode().getValue()).isEqualTo("AA");
    assertThat(msa.getMessageControlID().getValue()).isEqualTo("MSG00001");
  }

  @Test
  void generatesNegativeAcknowledgement() throws Exception {
    final Message message = hapiContext.getPipeParser().parse(TestMessages.ADT_A01);

    final Message nak = message.generateACK(
        AcknowledgmentCode.AE, new HL7Exception("simulated processing failure"));

    final MSA msa = (MSA) nak.get("MSA");
    assertThat(msa.getAcknowledgmentCode().getValue()).isEqualTo("AE");
    assertThat(msa.getMessageControlID().getValue()).isEqualTo("MSG00001");
  }
}
