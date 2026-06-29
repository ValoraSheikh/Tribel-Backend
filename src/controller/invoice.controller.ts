import { ApiError, ApiResponse, asyncHandler } from "../lib/index.ts";
import adminDB from "../lib/prisma/admin-db.ts";
import { getObject } from "../services/s3.service.ts";

export const getInvoiceByBooking = asyncHandler(async (req, res) => {
  const bookingId = req.params["bookingId"] as string;

  const booking = await adminDB.booking.findUnique({
    where: { id: bookingId },
  });

  if (!booking) {
    throw new ApiError("Booking not found", 404);
  }

  if (booking.guestId !== req.user.id) {
    throw new ApiError("Forbidden", 403);
  }

  const invoice = await adminDB.invoice.findUnique({
    where: { bookingId },
  });

  if (!invoice) {
    throw new ApiError("Invoice not yet generated", 404);
  }

  if (!invoice.pdfUrl) {
    throw new ApiError("Invoice PDF not available", 500);
  }

  const downloadUrl = await getObject({ key: invoice.pdfUrl });

  res
    .status(200)
    .json(
      new ApiResponse(
        { invoice, downloadUrl },
        "Invoice retrieved successfully",
        200,
      ),
    );
});

export const getUserInvoices = asyncHandler(async (req, res) => {
  const bookings = await adminDB.booking.findMany({
    where: { guestId: req.user.id },
    orderBy: { createdAt: "desc" },
  });

  const invoices = await Promise.all(
    bookings
      .filter((b) => b.invoiceId !== null)
      .map(async (b) => {
        const inv = await adminDB.invoice.findUnique({
          where: { bookingId: b.id },
        });
        let downloadUrl = null;
        if (inv?.pdfUrl) {
          downloadUrl = await getObject({ key: inv.pdfUrl });
        }
        return {
          bookingId: b.id,
          totalPrice: b.totalPrice,
          startDate: b.startDate,
          endDate: b.endDate,
          invoice: inv,
          downloadUrl,
        };
      }),
  );

  res
    .status(200)
    .json(
      new ApiResponse(invoices, "Invoices retrieved successfully", 200),
    );
});
