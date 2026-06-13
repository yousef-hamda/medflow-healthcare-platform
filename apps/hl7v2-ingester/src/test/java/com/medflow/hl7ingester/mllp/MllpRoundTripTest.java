package com.medflow.hl7ingester.mllp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import ca.uhn.hl7v2.DefaultHapiContext;
import ca.uhn.hl7v2.HapiContext;
import ca.uhn.hl7v2.app.Connection;
import ca.uhn.hl7v2.app.HL7Service;
import ca.uhn.hl7v2.app.Initiator;
import ca.uhn.hl7v2.app.ReceivingApplication;
import ca.uhn.hl7v2.model.Message;
import ca.uhn.hl7v2.model.v25.segment.MSA;
import com.medflow.hl7ingester.TestMessages;
import com.medflow.hl7ingester.fhir.FhirResourceWriter;
import com.medflow.hl7ingester.kafka.RawMessagePublisher;
import com.medflow.hl7ingester.mapping.AdtToFhirMapper;
import com.medflow.hl7ingester.mapping.OruToFhirMapper;
import com.medflow.hl7ingester.mapping.OrmToFhirMapper;
import java.net.ServerSocket;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * MLLP round-trip integration test: starts a HAPI {@link HL7Service} on a random port and uses a
 * HAPI client to send a synthetic ADT message, asserting a positive ACK is returned.
 *
 * <p>The FHIR writer and Kafka publisher are mocked so the test does not require external
 * infrastructure; the focus is the MLLP transport, handler dispatch and ACK generation.
 */
class MllpRoundTripTest {

  private HapiContext serverContext;
  private HapiContext clientContext;
  private HL7Service service;
  private Connection connection;

  private static int randomFreePort() throws Exception {
    try (ServerSocket socket = new ServerSocket(0)) {
      return socket.getLocalPort();
    }
  }

  @Test
  void sendsAdtAndReceivesPositiveAck() throws Exception {
    final int port = randomFreePort();

    final FhirResourceWriter writer = mock(FhirResourceWriter.class);
    final RawMessagePublisher publisher = mock(RawMessagePublisher.class);
    final Hl7MessageProcessor processor = new Hl7MessageProcessor(
        new AdtToFhirMapper(),
        new OruToFhirMapper(),
        new OrmToFhirMapper(),
        writer,
        publisher);

    final ReceivingApplication<Message> handler = new AdtMessageHandler(processor);

    serverContext = new DefaultHapiContext();
    service = serverContext.newServer(port, false);
    service.registerApplication("ADT", "A01", handler);
    service.startAndWait();

    clientContext = new DefaultHapiContext();
    connection = clientContext.newClient("localhost", port, false);
    final Initiator initiator = connection.getInitiator();
    final Message request = clientContext.getPipeParser().parse(TestMessages.ADT_A01);

    final Message response = initiator.sendAndReceive(request);

    final MSA msa = (MSA) response.get("MSA");
    assertThat(msa.getAcknowledgmentCode().getValue()).isEqualTo("AA");
    assertThat(msa.getMessageControlID().getValue()).isEqualTo("MSG00001");
  }

  @Test
  void unexpectedMetadataDoesNotBreakHandler() throws Exception {
    final FhirResourceWriter writer = mock(FhirResourceWriter.class);
    final RawMessagePublisher publisher = mock(RawMessagePublisher.class);
    final Hl7MessageProcessor processor = new Hl7MessageProcessor(
        new AdtToFhirMapper(),
        new OruToFhirMapper(),
        new OrmToFhirMapper(),
        writer,
        publisher);
    final AdtMessageHandler handler = new AdtMessageHandler(processor);

    final HapiContext ctx = new DefaultHapiContext();
    final Message request = ctx.getPipeParser().parse(TestMessages.ADT_A01);
    final Message ack = handler.processMessage(request, Map.of());

    final MSA msa = (MSA) ack.get("MSA");
    assertThat(msa.getAcknowledgmentCode().getValue()).isEqualTo("AA");
  }

  @AfterEach
  void tearDown() throws Exception {
    if (connection != null) {
      connection.close();
    }
    if (service != null) {
      service.stopAndWait();
    }
  }
}
