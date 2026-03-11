import { getSecuredClient } from "./prisma/prisma-rls.ts";

export interface UserDetail {
  sub: string;
  email: string;
  given_name: string;
  family_name: string;
  picture: string;
  name: string;
  nickname: string;
}

export const user = async (sub: string) => {
  const secureDB = getSecuredClient({
    role: "Super_Admin",
    tenantId: "",
    userId: "",
    auth0Id: sub,
  });

  const user = await secureDB.user.findUnique({
    where: {
      auth0Id: sub,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      auth0Id: true,
      email: true,
    },
  });

  return user;
};

export const createUser = async (user: UserDetail) => {
  const secureDB = getSecuredClient({
    role: "",
    tenantId: "",
    userId: "",
    auth0Id: user.sub,
  });

  const createUser = await secureDB.user.create({
    data: {
      auth0Id: user.sub,
      email: user.email,
      firstName: user.given_name || user.name,
      lastName: user.family_name || user.nickname,
      role: "Guest",
      avatar: user.picture,
    },
  });

  return createUser;
};
