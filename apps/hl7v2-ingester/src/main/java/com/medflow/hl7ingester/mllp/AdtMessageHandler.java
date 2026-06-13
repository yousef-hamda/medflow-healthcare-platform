package com.medflow.hl7ingester.mllp;

import ca.uhn.hl7v2.model.Message;
import org.springframework.stereotype.Component;

/**
 * {@link ca.uhn.hl7v2.app.ReceivingApplication} handler for ADT messages
 * (trigger events A01, A02, A03, A08).
 */
@Component
public class AdtMessageHandler extends AbstractMessageHandler {

  /**
   * Creates the handler.
   *
   * @param processor the shared message processor
   */
  public AdtMessageHandler(final Hl7MessageProcessor processor) {
    super(processor);
  }

  @Override
  public boolean canProcess(final Message message) {
    return true;
  }
}
