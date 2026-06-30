import { ApiResponse, asyncHandler } from "../lib/index.ts";
import { deleteObject, putObject } from "../services/s3.service.ts";
import { generateKey, type UploadEntity } from "../utils/s3keys.ts";

export const getPresignedUploadUrl = asyncHandler(async (req, res) => {
  const { entity, fileType, entityId } = req.body;

  const extension = fileType.split("/")[1];
  const entityType = entity as UploadEntity;

  const key = generateKey[entityType]({ entityId: entityId, ext: extension });

  const uploadUrl = await putObject({ key: key, contentType: fileType });

  return res
    .status(200)
    .json(
      new ApiResponse(
        { uploadUrl: uploadUrl, key: key },
        "Upload URL created",
        200,
      ),
    );
});

export const deleteKey = asyncHandler(async (req, res) => {
  const { key } = req.body;

  await deleteObject({ key: key });
  
  return res
    .status(200)
    .json(new ApiResponse([], "Image Key delete successfully", 200));
});
