import { ApiError, ApiResponse, asyncHandler } from "../lib/index.ts";
import prisma from "../lib/prisma/db.ts";
import { getSecuredClient } from "../lib/prisma/prisma-rls.ts";
import { getObject } from "../services/s3.service.ts";

export const getInvoiceByBooking = asyncHandler(async (req, res) => {
  const bookingId = req.params["bookingId"] as string;

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: req.user.role,
    auth0Id: req.oidc.user?.sub,
  });

  const booking = await securedDB.booking.findUnique({
    where: { id: bookingId },
  });

  if (!booking) {
    throw new ApiError("Booking not found", 404);
  }

  if (booking.guestId !== req.user.id) {
    throw new ApiError("Forbidden", 403);
  }

  const invoice = await securedDB.invoice.findUnique({
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

export const getAdminInvoiceByBooking = asyncHandler(async (req, res) => {
  const bookingId = req.params["bookingId"] as string;

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const user = await securedDB.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, tenant: true, role: true, auth0Id: true },
  });

  if (!user?.tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  const withRLS = getSecuredClient({
    userId: user.id,
    tenantId: user.tenant.id,
    role: user.role,
    auth0Id: user.auth0Id,
  });

  const booking = await withRLS.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, propertyId: true, invoiceId: true },
  });

  if (!booking) {
    throw new ApiError("Booking not found", 404);
  }

  const property = await prisma.property.findUnique({
    where: { id: booking.propertyId },
    select: { adminId: true },
  });

  if (!property || property.adminId !== req.user.id) {
    throw new ApiError("Forbidden", 403);
  }

  const invoice = await withRLS.invoice.findUnique({
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
  const page = parseInt(req.query.page as string) || 1;
  let limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  limit = Math.min(Math.max(limit, 1), 50);

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: req.user.role,
    auth0Id: req.oidc.user?.sub,
  });

  const bookings = await securedDB.booking.findMany({
    where: { guestId: req.user.id, invoiceId: { not: null } },
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
  });

  const invoices = await Promise.all(
    bookings.map(async (b) => {
      const inv = await securedDB.invoice.findUnique({
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
