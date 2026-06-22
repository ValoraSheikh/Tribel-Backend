import type { InvoiceData } from "../config/types.ts";

async function invoiceWorker({ msg }: { msg: InvoiceData }) {
  const { title, email, body, invoice } = msg;

  return { title, email, body, invoice };
}

export default invoiceWorker;
