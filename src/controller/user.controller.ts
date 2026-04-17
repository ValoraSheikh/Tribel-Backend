import { ApiError, ApiResponse, asyncHandler } from "../lib/index.ts";
import { getSecuredClient } from "../lib/prisma/prisma-rls.ts";
import client from "../lib/redis/redis-cache.ts";
import redisClient from "../lib/redis/redis.ts";
import { deleteObject } from "../services/s3.service.ts";

export type AuthUser = {
  given_name: string;
  name: string;
  nickname: string;
  family_name: string;
  email: string;
  picture: string;
  role: "Guest" | "Staff" | "Admin" | "Super_Admin";
  sub: string;
};

export const loginUser = asyncHandler(async (req, res) => {
  const isAuthenticated = req.oidc?.isAuthenticated?.() ?? false;

  if (!isAuthenticated || !req.oidc?.user) {
    throw new ApiError("User is not authenticated", 401);
  }

  const authUser = req.oidc.user as AuthUser;

  const userCache = await client.get(`user:${authUser.sub}`);

  if (userCache) {
    return res.json(
      new ApiResponse(JSON.parse(userCache), "User Login Successfully", 200),
    );
  }

  const securedDB = getSecuredClient({
    tenantId: "",
    role: "",
    userId: req.user.id || "",
    auth0Id: authUser.sub,
  });

  const user = await securedDB.user.upsert({
    where: { auth0Id: authUser.sub },
    update: {
      email: authUser.email,
    },
    create: {
      firstName: authUser.given_name || authUser.name,
      lastName: authUser.family_name || authUser.nickname,
      auth0Id: authUser.sub,
      email: authUser.email,
      avatar: authUser.picture,
      role: authUser.role || "Guest",
    },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      avatar: true,
      role: true,
      auth0Id: true,
      tenant: true,
      createdAt: true,
      updatedAt: true,
      id: true,
      phoneNo: true,
    },
  });

  await client.set(`user:${authUser.sub}`, JSON.stringify(user), "EX", 3600);

  return res.json(new ApiResponse(user, "User Login Successfully", 200));
});

export const logout = asyncHandler(async (req, res) => {
  if (!req.oidc.isAuthenticated()) {
    throw new ApiError("User is not authenticated", 401);
  }

  const authUser = req.oidc.user as AuthUser;

  res.oidc.logout();

  await client.del(`user:${authUser.sub}`);
  await client.del(`session:${authUser.sub}`);

  return res.json(new ApiResponse({}, "User logout Successfully", 200));
});

export const updateUserProfile = asyncHandler(async (req, res) => {
  const { firstName, lastName, phoneNo } = req.body;

  const authUser = req.oidc.user as AuthUser;

  if (!authUser.sub) {
    throw new ApiError("User ID is required to update profile", 400);
  }

  if (!req.user || !req.user.id) {
    throw new ApiError("User not found", 401);
  }

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: authUser.sub,
  });

  const updatedUser = await securedDB.user.update({
    where: { id: req.user.id },
    data: {
      firstName: firstName,
      lastName: lastName,
      // avatar: avatar,
      phoneNo: phoneNo,
    },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      avatar: true,
      role: true,
      auth0Id: true,
      tenant: true,
      createdAt: true,
      updatedAt: true,
      id: true,
      phoneNo: true,
    },
  });

  await client.set(
    `user:${authUser.sub}`,
    JSON.stringify(updatedUser),
    "EX",
    3600,
  );

  req.user = {
    id: updatedUser.id,
    role: updatedUser.role,
    email: updatedUser.email,
    name: updatedUser.firstName,
  };

  await client.set(
    `session:${updatedUser.auth0Id}`,
    JSON.stringify(req.user),
    "EX",
    3600,
  );

  return res.json(
    new ApiResponse(updatedUser, "User updated successfully", 200),
  );
});

export const updateAvatar = asyncHandler(async (req, res) => {
  const { avatarUrl, key } = req.body;
  const authUser = req.oidc.user as AuthUser;

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: "",
  });

  await securedDB.user.update({
    where: {
      id: req.user.id,
    },
    data: {
      avatar: avatarUrl,
    },
  });

  await client.del(`user:${authUser.sub}`);

  // await deleteObject({ key: key });

  res
    .status(200)
    .json(new ApiResponse({}, "Updated User Avatar successfully", 200));
});

export const deleteUser = asyncHandler(async (req, res) => {
  const authUser = req.oidc.user as AuthUser;

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: authUser.sub,
  });

  const deletedUser = await securedDB.user.delete({
    where: {
      auth0Id: authUser.sub,
    },
  });

  await client.del(`user:${authUser.sub}`);
  await client.del(`session:${authUser.sub}`);

  return res.json(
    new ApiResponse(deletedUser, "User deleted successfully", 200),
  );
});
