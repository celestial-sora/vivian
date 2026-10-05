import "server-only";
import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, ListMultipartUploadsCommand, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { StorageError, partSize } from "@/lib/cloud-storage";

export function r2Configuration() {
  const accountId = process.env.R2_ACCOUNT_ID, accessKeyId = process.env.R2_ACCESS_KEY_ID, secretAccessKey = process.env.R2_SECRET_ACCESS_KEY, bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId) || !accessKeyId || !secretAccessKey || !bucket) throw new StorageError("R2 storage is not configured yet.", 503);
  return { bucket, endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } };
}
export function r2Client() {
  const config = r2Configuration();
  return new S3Client({ region: "auto", endpoint: config.endpoint, credentials: config.credentials, forcePathStyle: true, maxAttempts: 2, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
}
const bucket = () => r2Configuration().bucket;
const timeout = () => ({ abortSignal: AbortSignal.timeout(20_000) });
function missing(error: unknown) { return !!error && typeof error === "object" && ["NoSuchUpload", "NoSuchKey", "NotFound"].includes(String((error as { name?: string }).name)); }
export async function startModelUpload(key: string): Promise<string> {
  const result = await r2Client().send(new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key, ContentType: "application/zip" }), timeout());
  if (!result.UploadId) throw new StorageError("Could not start the model upload.", 503);
  return result.UploadId;
}
export async function signModelParts(key: string, uploadId: string, bytes: number, first: number) {
  partSize(bytes, first);
  const client = r2Client();
  return Promise.all(Array.from({ length: Math.min(8, Math.ceil(bytes / (16 * 1024 * 1024)) - first + 1) }, (_, index) => first + index).map(async (part) => {
    const size = partSize(bytes, part);
    const url = await getSignedUrl(client, new UploadPartCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumber: part, ContentLength: size }), { expiresIn: 300, signableHeaders: new Set(["content-length"]) });
    return { part, size, url };
  }));
}
export async function modelObjectSize(key: string): Promise<number | null> {
  try { return (await r2Client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }), timeout())).ContentLength ?? null; }
  catch (error) { if (missing(error)) return null; throw error; }
}
export async function completeModelUpload(key: string, uploadId: string, bytes: number): Promise<void> {
  // Recovery after a successful completion whose HTTP/database response was lost.
  if (await modelObjectSize(key) === bytes) return;
  const client = r2Client();
  const result = await client.send(new ListPartsCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }), timeout());
  const parts = result.Parts ?? [];
  if (result.IsTruncated || parts.length !== Math.ceil(bytes / (16 * 1024 * 1024)) || parts.some((part, index) => part.PartNumber !== index + 1 || part.Size !== partSize(bytes, index + 1) || !part.ETag)) throw new StorageError("Model upload is incomplete or has an incorrect size.");
  await client.send(new CompleteMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })) } }), timeout());
  if (await modelObjectSize(key) !== bytes) throw new StorageError("Model size could not be verified.", 503);
}
export async function deleteR2Object(key: string, uploadId?: string | null): Promise<void> {
  const client = r2Client();
  if (uploadId) {
    try { await client.send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }), timeout()); }
    catch (error) { if (!missing(error)) throw error; }
  }
  // Also recover multipart sessions created before their ID reached the DB.
  let marker: string | undefined, uploadMarker: string | undefined;
  do {
    const page = await client.send(new ListMultipartUploadsCommand({ Bucket: bucket(), Prefix: key, KeyMarker: marker, UploadIdMarker: uploadMarker }), timeout());
    for (const upload of page.Uploads ?? []) if (upload.Key === key && upload.UploadId) {
      try { await client.send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: upload.UploadId }), timeout()); }
      catch (error) { if (!missing(error)) throw error; }
    }
    marker = page.IsTruncated ? page.NextKeyMarker : undefined; uploadMarker = page.NextUploadIdMarker;
  } while (marker);
  await client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }), timeout());
}
export async function signModelDownload(key: string): Promise<string> {
  return getSignedUrl(r2Client(), new GetObjectCommand({ Bucket: bucket(), Key: key, ResponseContentType: "application/zip", ResponseContentDisposition: "attachment" }), { expiresIn: 300 });
}
export async function putR2Image(key: string, bytes: Buffer): Promise<void> {
  await r2Client().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: bytes, ContentLength: bytes.length, ContentType: "image/webp" }), timeout());
}
export async function getR2Image(key: string): Promise<Blob> {
  const result = await r2Client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }), timeout());
  if (!result.Body || (result.ContentLength ?? Infinity) > 8 * 1024 * 1024) throw new StorageError("Scene image unavailable.", 503);
  return new Blob([new Uint8Array(await result.Body.transformToByteArray())], { type: "image/webp" });
}
