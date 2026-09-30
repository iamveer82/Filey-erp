/** Keep legacy customer-invoice requests out of Filey's own billing account. */
export function dispatchStripeAction(
  action: string,
  billingAction: () => Promise<Response>,
  headers: HeadersInit
): Promise<Response> {
  if (action === "pay_invoice")
    return Promise.resolve(
      Response.json(
        {
          error:
            "Invoice payments are arranged with the seller. Contact the seller to pay this invoice.",
        },
        { status: 410, headers }
      )
    );
  return billingAction();
}
