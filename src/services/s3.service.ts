import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3client } from "../config/aws.ts";

type params = {
  key: string;
  contentType: string;
};

export async function getObect({ key }: { key: string }) {
  const command = new GetObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
  });

  return await getSignedUrl(S3client, command);
}

export async function putObject({ key, contentType }: params) {
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  return await getSignedUrl(S3client, command, {
    expiresIn: 5 * 60,
  });
}

export async function deleteObject({ key }: { key: string }) {
  const command = new DeleteObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
  });

  return await S3client.send(command);
}
