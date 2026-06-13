package com.medflow.hl7ingester.mllp;

import ca.uhn.hl7v2.AcknowledgmentCode;
import ca.uhn.hl7v2.HL7Exception;
import ca.uhn.hl7v2.app.ReceivingApplication;
import ca.uhn.hl7v2.app.ReceivingApplicationException;
import ca.uhn.hl7v2.model.Message;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Base {@link ReceivingApplication} that maps an inbound HL7v2 message through the shared
 * {@link Hl7MessageProcessor} and returns an application ACK (AA) or NAK (AE).
 *
 * <p>On a processing failure the handler routes to the dead-letter path: it logs only the message
 * control id (never PHI) and generates an AE acknowledgement.
 */
public abstract class AbstractMessageHandler implements ReceivingApplication<Message> {

  private static final Logger LOG = LoggerFactory.getLogger(AbstractMessageHandler.class);

  private final Hl7MessageProcessor processor;

  /**
   * Creates the handler.
   *
   * @param processor the shared message processor
   */
  protected AbstractMessageHandler(final Hl7MessageProcessor processor) {
    this.processor = processor;
  }

  @Override
  public Message processMessage(final Message message, final Map<String, Object> metadata)
      throws ReceivingApplicationException, HL7Exception {
    final String controlId = controlId(message);
    try {
      final String raw = message.encode();
      processor.process(message, raw);
      return message.generateACK(); // AA
    } catch (final Exception ex) {
      // Dead-letter path: log control id only — never PHI segment values.
      LOG.error("HL7 message processing failed (dead-letter) controlId={}: {}",
          controlId, ex.toString());
      try {
        return message.generateACK(AcknowledgmentCode.AE, new HL7Exception(ex.getMessage()));
      } catch (final Exception ackEx) {
        throw new ReceivingApplicationException("Failed to generate NAK", ackEx);
      }
    }
  }

  private String controlId(final Message message) {
    try {
      return ((ca.uhn.hl7v2.model.v25.segment.MSH) message.get("MSH"))
          .getMessageControlID().getValue();
    } catch (final Exception ex) {
      return "unknown";
    }
  }
}
