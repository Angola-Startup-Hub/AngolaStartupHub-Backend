import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { z } from "zod";

// Object storage do Neon (API compatível com S3). O browser envia o ficheiro DIRECTAMENTE para o bucket
// com um URL assinado: não passa pela função serverless (rápido e sem limite de 4,5 MB do Vercel).
const LIMITS = { "image/": 10 * 1024 * 1024, "video/": 200 * 1024 * 1024 };
const ALLOWED = /^(image\/(jpeg|png|webp|avif|gif)|video\/(mp4|webm))$/;

const BUCKET = () => process.env.S3_BUCKET || "news";
// Com uma CDN/proxy à frente do bucket, define S3_PUBLIC_URL; senão usa o endpoint público do Neon
const PUBLIC = () => (process.env.S3_PUBLIC_URL || `${process.env.AWS_ENDPOINT_URL_S3}/${BUCKET()}`).replace(/\/$/, "");

let client;
const s3 = () =>
  (client ??= new S3Client({
    region: process.env.AWS_REGION,
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    forcePathStyle: true, // o Neon só suporta path-style
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
  }));

export async function presign({ filename, contentType, size, base, suffix }) {
  if (!process.env.AWS_ENDPOINT_URL_S3) throw new Error("Storage não configurado");
  if (!ALLOWED.test(contentType)) throw new z.ZodError([{ code: "custom", path: ["contentType"], message: "Tipo de ficheiro não permitido" }]);
  const max = Object.entries(LIMITS).find(([k]) => contentType.startsWith(k))[1];
  if (size > max) throw new z.ZodError([{ code: "custom", path: ["size"], message: `Ficheiro demasiado grande (máx. ${max / 1024 / 1024} MB)` }]);
  const ext = (filename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  // Variantes de imagem: mesmo "base" (uuid) com sufixo de largura -> img/<uuid>-480.webp, -960, -1600
  const key = base && suffix ? `img/${base}-${suffix}.${ext}` : `${new Date().getFullYear()}/${randomUUID()}.${ext}`;
  const uploadUrl = await getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      ContentType: contentType,
      ContentLength: size,
      CacheControl: "public, max-age=31536000, immutable", // nomes únicos => cache eterna no CDN
    }),
    { expiresIn: 300 },
  );
  return { uploadUrl, publicUrl: `${PUBLIC()}/${key}`, headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" } };
}
