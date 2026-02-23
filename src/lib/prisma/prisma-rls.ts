import prisma from "./db.ts";

interface RLScontext {
  userId: string;
  role: string;
  tenantId: string;
  auth0Id: string;
}

export function getSecuredClient(context: RLScontext) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const userId = context.userId || "";
          const tenantId = context.tenantId || "";
          const role = context.role || "";
          const auth0Id = context.auth0Id || "";

          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`
              SELECT set_config('app.current_role', ${role}::text, true),
              set_config('app.current_tenant_id', ${tenantId}::text, true),
              set_config('app.current_userId', ${userId}::text, true),
              set_config('app.current_user_auth0_id', ${auth0Id}::text, true)
              `,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}
