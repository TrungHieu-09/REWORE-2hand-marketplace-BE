import path from "path";
import { randomUUID } from "crypto";
import { supabase } from "../config/supabase";
import { createError } from "../middleware/error.middleware";

export type StorageBucket = "id-cards" | "product-images";

export type SupabaseUploadResult = {
  path: string;
  publicUrl: string | null;
};

const assertSupabaseConfigured = () => {
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!process.env.SUPABASE_URL || !secretKey) {
    console.error("[SUPABASE STORAGE CONFIG MISSING] SUPABASE_URL and SUPABASE_SECRET_KEY are required");
    throw createError("Unable to upload file", 500);
  }
};

const normalizeFolder = (folder: string) => folder.replace(/^\/+|\/+$/g, "");

const extensionFromOriginalName = (originalName: string, mimeType: string) => {
  const ext = path.extname(originalName).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return ext;
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
};

export const uploadToSupabase = async (
  file: Express.Multer.File,
  bucket: StorageBucket,
  folder: string
): Promise<SupabaseUploadResult> => {
  assertSupabaseConfigured();

  const normalizedFolder = normalizeFolder(folder);
  const filename = `${randomUUID()}${extensionFromOriginalName(file.originalname, file.mimetype)}`;
  const objectPath = normalizedFolder ? `${normalizedFolder}/${filename}` : filename;

  const { error } = await supabase.storage.from(bucket).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });

  if (error) {
    console.error("[SUPABASE UPLOAD ERROR]", {
      bucket,
      path: objectPath,
      message: error.message,
    });
    throw createError("Unable to upload file", 500);
  }

  if (bucket === "product-images") {
    const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    return { path: objectPath, publicUrl: data.publicUrl };
  }

  return { path: objectPath, publicUrl: null };
};

export const createSupabaseSignedUrl = async (bucket: StorageBucket, objectPath?: string | null, expiresIn = 300) => {
  if (!objectPath) return null;

  if (/^https?:\/\//i.test(objectPath)) return objectPath;
  if (objectPath.startsWith("/uploads/")) return objectPath;

  assertSupabaseConfigured();

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, expiresIn);
  if (error) {
    console.error("[SUPABASE SIGNED URL ERROR]", {
      bucket,
      path: objectPath,
      message: error.message,
    });
    return null;
  }

  return data.signedUrl;
};

export const removeSupabaseObjects = async (bucket: StorageBucket, paths: string[]) => {
  const cleanPaths = paths.filter(Boolean);
  if (cleanPaths.length === 0) return;

  try {
    assertSupabaseConfigured();
    const { error } = await supabase.storage.from(bucket).remove(cleanPaths);
    if (error) {
      console.error("[SUPABASE REMOVE ERROR]", {
        bucket,
        paths: cleanPaths,
        message: error.message,
      });
    }
  } catch (err) {
    console.error("[SUPABASE REMOVE ERROR]", err instanceof Error ? err.message : err);
  }
};
