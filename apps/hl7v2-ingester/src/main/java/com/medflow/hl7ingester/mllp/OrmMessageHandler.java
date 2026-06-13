package com.medflow.hl7ingester.mllp;

import ca.uhn.hl7v2.model.Message;
import org.springframework.stereotype.Component;

/**
 * {@link ca.uhn.hl7v2.app.ReceivingApplication} handler for ORM^O01 order messages.
 */
@Component
public class OrmMessageHandler extends AbstractMessageHandler {

  /**
   * Creates the handler.
   *
   * @param processor the shared message processor
   */
  public OrmMessageHandler(final Hl7MessageProcessor processor) {
    super(processor);
  }

  @Override
  public boolean canProcess(final Message message) {
    return true;
  }
}
