/** GST Rule 48 invoice copies: goods go in triplicate, services in duplicate. "1" prints no label. */
export const GST_COPY_SETS: Record<string, string[]> = {
  "1": [],
  "2": ["Original for recipient", "Duplicate for supplier"],
  "3": ["Original for recipient", "Duplicate for transporter", "Triplicate for supplier"],
};
export const GST_COPIES_KEY = "gst_invoice_copies";
