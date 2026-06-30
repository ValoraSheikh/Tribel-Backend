import { Resend } from "resend";
import { render } from "@react-email/components";
import adminDB from "../../prisma/admin-db.ts";
import { getObject } from "../../../services/s3.service.ts";
import { BookingConfirmationEmail } from "../../../emails/booking-confirmation.tsx";
import type { Emaildata } from "../config/types.ts";

const resend = new Resend(process.env.RESEND_API_KEY);
const fromEmail = process.env.RESEND_FROM_EMAIL;

function formatDate(date: Date): string {
  const d = date.getDate().toString().padStart(2, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

async function emailWorker({ msg }: { msg: Emaildata }) {
  const { bookingId, paymentId } = msg;

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

  if (!booking.guest.email) {
    throw new Error(`Guest for booking ${bookingId} has no email`);
  }

  if (!booking.property.tenant) {
    throw new Error(`Property ${booking.propertyId} has no tenant`);
  }

  if (!fromEmail) {
    throw new Error("RESEND_FROM_EMAIL is not configured");
  }

  const guest = booking.guest;
  const property = booking.property;
  const tenant = property.tenant;
  const guestName = `${guest.firstName} ${guest.lastName ?? ""}`.trim();

  let propertyImage = "";
  if (property.images.length > 0 && property.images[0]) {
    propertyImage = await getObject({ key: property.images[0] });
  }

  const emailProps = {
    guestName,
    propertyName: property.title,
    propertyImage,
    propertyAddress: property.address,
    propertyCity: property.city,
    propertyState: property.state,
    propertyCountry: property.country,
    propertyPostalCode: property.postal_code,
    propertyContactEmail: property.contact_email,
    propertyContactPhone: property.contact_phone,
    bookingId: booking.id,
    checkIn: formatDate(booking.startDate),
    checkOut: formatDate(booking.endDate),
    amount: Number(booking.totalPrice).toFixed(2),
    currency: tenant.currency,
    currencySymbol: "₹",
    paymentMode: booking.paymentMode,
    ...(property.gstin ? { gstin: property.gstin } : {}),
    ...(paymentId ? { paymentId } : {}),
  };

  const html = await render(<BookingConfirmationEmail {...emailProps} />);

  const sendOptions: Record<string, unknown> = {
    from: fromEmail,
    to: guest.email,
    subject: `Booking Confirmed — ${property.title}`,
    html,
  };

  if (property.contact_email) {
    sendOptions.replyTo = property.contact_email;
  }

  const { data, error } = await resend.emails.send(sendOptions as any);

  if (error) {
    throw new Error(`Resend API error: ${error.message}`);
  }

  return { sent: true, emailId: data?.id };
}

export default emailWorker;
