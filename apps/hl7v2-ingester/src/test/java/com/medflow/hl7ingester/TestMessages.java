package com.medflow.hl7ingester;

/**
 * Synthetic HL7 v2.5 test messages used across the unit and integration tests.
 *
 * <p>All values are fabricated for testing (names like {@code SYNTHEA^TEST}); no real PHI is used.
 * Segments are separated by carriage returns as required by the HL7v2 encoding rules.
 */
public final class TestMessages {

  private TestMessages() {
  }

  /** ADT^A01 admit message with PID and PV1. */
  public static final String ADT_A01 = String.join("\r",
      "MSH|^~\\&|MEDFLOW_ADT|MEDFLOW|RECEIVER|HOSP|20260611120000||ADT^A01|MSG00001|P|2.5",
      "EVN|A01|20260611120000",
      "PID|1||MRN123456^^^MEDFLOW^MR||SYNTHEA^TEST^Q||19850214|M|||123 SYNTHETIC ST^^TESTVILLE^CA^90210",
      "PV1|1|I|WARD3^301^A||||DOC1^WELBY^MARCUS|||MED||||||||V0001234^^^MEDFLOW^VN");

  /** ADT^A03 discharge message. */
  public static final String ADT_A03 = String.join("\r",
      "MSH|^~\\&|MEDFLOW_ADT|MEDFLOW|RECEIVER|HOSP|20260611150000||ADT^A03|MSG00002|P|2.5",
      "EVN|A03|20260611150000",
      "PID|1||MRN123456^^^MEDFLOW^MR||SYNTHEA^TEST^Q||19850214|M",
      "PV1|1|I|WARD3^301^A||||||||||||||||V0001234^^^MEDFLOW^VN");

  /** ORU^R01 result message with one OBR and two LOINC-coded OBX observations. */
  public static final String ORU_R01 = String.join("\r",
      "MSH|^~\\&|MEDFLOW_LAB|MEDFLOW|RECEIVER|HOSP|20260611130000||ORU^R01|MSG00003|P|2.5",
      "PID|1||MRN123456^^^MEDFLOW^MR||SYNTHEA^TEST^Q||19850214|M",
      "OBR|1|PLACER001|FILLER999|24323-8^Comprehensive metabolic panel^LN|||20260611123000",
      "OBX|1|NM|2345-7^Glucose^LN||110|mg/dL|70-99|H|||F",
      "OBX|2|NM|2160-0^Creatinine^LN||0.9|mg/dL|0.6-1.3|N|||F");

  /** ORM^O01 order message with one ORC/OBR order. */
  public static final String ORM_O01 = String.join("\r",
      "MSH|^~\\&|MEDFLOW_CPOE|MEDFLOW|RECEIVER|HOSP|20260611110000||ORM^O01|MSG00004|P|2.5",
      "PID|1||MRN123456^^^MEDFLOW^MR||SYNTHEA^TEST^Q||19850214|M",
      "ORC|NW|PLACER555|||||^^^20260611110000",
      "OBR|1|PLACER555||24323-8^Comprehensive metabolic panel^LN");

  /** Malformed message used to exercise the parse-error / dead-letter path. */
  public static final String MALFORMED = "NOTASEGMENT|garbage|data";
}
