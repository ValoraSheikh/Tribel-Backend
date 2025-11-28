import prisma from "../utils/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../utils/index.ts";

type AuthUser = {
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
  if (!req.oidc || !req.oidc.isAuthenticated()) {
    throw new ApiError("User is not authenticated", 401);
  }

  const authUser = req.oidc.user as AuthUser;

  const user = await prisma.user.upsert({
    where: { auth0Id: authUser.sub },
    update: {
      firstName: authUser.given_name || authUser.name,
      lastName: authUser.family_name || authUser.nickname,
      email: authUser.email,
      avatar: authUser.picture,
    },
    create: {
      firstName: authUser.given_name || authUser.name,
      lastName: authUser.family_name || authUser.nickname,
      auth0Id: authUser.sub,
      email: authUser.email,
      avatar: authUser.picture,
      role: authUser.role || "Guest",
    },
  });

  return res.json(new ApiResponse(user, "User Login Successfully", 200));
});

export const logout = asyncHandler(async (req, res) => {
  if (!req.oidc.isAuthenticated()) {
    throw new ApiError("User is not authenticated", 401);
  }

  res.oidc.logout();

  return res.json(new ApiResponse({}, "User logout Successfully", 200));
});

export const updateUserProfile = asyncHandler(async (req, res) => {
  const { firstName, lastName, avatar, phoneNo } = req.body;

  const authUser = req.oidc.user as AuthUser;

  if (!authUser.sub) {
    throw new ApiError("User ID is required to update profile", 400);
  }

  const updatedUser = await prisma.user.update({
    where: { auth0Id: authUser.sub },
    data: {
      firstName: firstName,
      lastName: lastName,
      avatar: avatar,
      phoneNo: phoneNo,
    },
  });

  return res.json(
    new ApiResponse(updatedUser, "User updated successfully", 200),
  );
});

export const deleteUser = asyncHandler(async (req, res) => {
  const authUser = req.oidc.user as AuthUser;

  const deletedUser = await prisma.user.delete({
    where: {
      auth0Id: authUser.sub,
    },
  });

  return res.json(
    new ApiResponse(deletedUser, "User deleted successfully", 200),
  );
});
