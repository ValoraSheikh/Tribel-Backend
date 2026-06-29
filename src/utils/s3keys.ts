import { InventoryIncludedObjectVersions } from "@aws-sdk/client-s3";

type keyParams = { entityId: string; ext: string };

export const generateKey = {
  user: ({ entityId, ext }: keyParams) => {
    return `public/users/${entityId}/profile/${crypto.randomUUID()}.${ext}`;
  },

  tenant: ({ entityId, ext }: keyParams) => {
    return `public/tenants/${entityId}/tenant/${crypto.randomUUID()}.${ext}`;
  },

  property: ({ entityId, ext }: keyParams) => {
    return `public/properties/${entityId}/property/${crypto.randomUUID()}.${ext}`;
  },

  roomTemplate: ({ entityId, ext }: { entityId: string; ext: string }) => {
    return `public/roomTemplates/${entityId}/roomTemplate/${crypto.randomUUID()}.${ext}`;
  },

  booking: ({ entityId, ext }: { entityId: string; ext: string }) => {
    return `private/bookings/${entityId}/booking/${crypto.randomUUID()}.${ext}`;
  },

  invoice: ({ entityId, ext }: { entityId: string; ext: string }) => {
    return `private/invoices/${entityId}/invoice/${crypto.randomUUID()}.${ext}`;
  },
};

export type UploadEntity = keyof typeof generateKey;
