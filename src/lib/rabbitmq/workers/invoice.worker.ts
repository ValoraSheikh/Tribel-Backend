import puppeteer from "puppeteer";
import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import adminDB from "../../prisma/admin-db.ts";
import { uploadPdfBuffer } from "../../../services/s3.service.ts";
import { generateKey } from "../../../utils/s3keys.ts";
import type { InvoiceData } from "../config/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "templates",
  "invoice.html",
);

function formatDate(date: Date): string {
  const d = date.getDate().toString().padStart(2, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

async function generateInvoiceNo(): Promise<string> {
  const today = new Date();
  const datePart = today.toISOString().slice(0, 10).replace(/-/g, "");

  const latest = await adminDB.invoice.findFirst({
    where: { invoiceNo: { startsWith: `INV-${datePart}-` } },
    orderBy: { invoiceNo: "desc" },
    select: { invoiceNo: true },
  });

  let counter = 1;
  if (latest?.invoiceNo) {
    const parts = latest.invoiceNo.split("-");
    const lastNum = parts[parts.length - 1];
    if (lastNum) {
      counter = parseInt(lastNum, 10) + 1;
    }
  }

  return `INV-${datePart}-${counter.toString().padStart(5, "0")}`;
}

function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  let html = template;
  for (const [key, value] of Object.entries(vars)) {
    const sectionPattern = new RegExp(
      `\\{\\{#${key}\\}\\}([\\s\\S]*?)\\{\\{/${key}\\}\\}`,
      "gm",
    );
    html = html.replace(sectionPattern, value ? "$1" : "");
    html = html.split(`{{${key}}}`).join(value);
  }
  return html;
}

async function invoiceWorker({ msg }: { msg: InvoiceData }) {
  const { bookingId, paymentId } = msg;

  const existing = await adminDB.invoice.findUnique({
    where: { bookingId },
  });
  if (existing?.status === "GENERATED") {
    return {
      invoiceId: existing.id,
      invoiceNo: existing.invoiceNo,
      status: "GENERATED",
    };
  }

  const booking = await adminDB.booking.findUnique({
    where: { id: bookingId },
    include: {
      guest: true,
      property: {
        include: { tenant: true },
      },
    },
  });

  if (!booking) {
    throw new Error(`Booking ${bookingId} not found`);
  }

  if (!booking.property.tenant) {
    throw new Error(`Property ${booking.propertyId} has no tenant`);
  }

  const payment = paymentId
    ? await adminDB.payment.findUnique({ where: { id: paymentId } })
    : null;

  if (paymentId && !payment) {
    throw new Error(`Payment ${paymentId} not found`);
  }

  const guest = booking.guest;
  const property = booking.property;
  const tenant = property.tenant;

  const invoiceNo = await generateInvoiceNo();
  const invoiceDate = formatDate(new Date());
  const subtotal = Number(booking.totalPrice);

  const template = await readFile(TEMPLATE_PATH, "utf-8");

  const html = renderTemplate(template, {
    tenantName: tenant.name,
    propertyTitle: property.title,
    propertyAddress: property.address,
    propertyCity: property.city,
    propertyState: property.state,
    propertyPostalCode: property.postal_code,
    propertyCountry: property.country,
    propertyContact: `${property.contact_email} / ${property.contact_phone}`,
    gstin: property.gstin ?? "",
    invoiceNo,
    invoiceDate,
    guestName: `${guest.firstName} ${guest.lastName ?? ""}`.trim(),
    guestEmail: guest.email,
    guestPhone: guest.phoneNo ?? "",
    bookingId: booking.id,
    paymentId: payment?.id ?? "",
    checkIn: formatDate(booking.startDate),
    checkOut: formatDate(booking.endDate),
    paymentMode: booking.paymentMode,
    currency: tenant.currency,
    currencySymbol: "₹",
    subtotal: subtotal.toFixed(2),
    total: subtotal.toFixed(2),
  });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let pdfBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });
    pdfBuffer = Buffer.from(pdf);
  } finally {
    await browser.close();
  }

  const s3Key = generateKey.invoice({
    entityId: bookingId,
    ext: "pdf",
  });

  await uploadPdfBuffer({ key: s3Key, buffer: pdfBuffer });

  const invoice = await adminDB.$transaction(async (tx) => {
    const inv = await tx.invoice.upsert({
      where: { bookingId },
      create: {
        bookingId,
        paymentId: paymentId ?? null,
        invoiceNo,
        subtotal,
        taxAmount: 0,
        totalAmount: subtotal,
        pdfUrl: s3Key,
        status: "GENERATED",
      },
      update: {
        paymentId: paymentId ?? null,
        invoiceNo,
        subtotal,
        taxAmount: 0,
        totalAmount: subtotal,
        pdfUrl: s3Key,
        status: "GENERATED",
      },
    });

    await tx.booking.update({
      where: { id: bookingId },
      data: { invoiceId: inv.id },
    });

    return inv;
  });

  return {
    invoiceId: invoice.id,
    invoiceNo: invoice.invoiceNo,
    status: invoice.status,
  };
}

export default invoiceWorker;
