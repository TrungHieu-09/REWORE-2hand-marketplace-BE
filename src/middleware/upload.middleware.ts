import multer from "multer";
import { Request, Response, NextFunction } from "express";
import { createError } from "./error.middleware";

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const createImageUpload = (maxFiles: number) => multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_SIZE_BYTES,
    files: maxFiles,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      cb(createError("Only JPG, PNG, and WEBP images are allowed", 400));
      return;
    }

    cb(null, true);
  },
});

const sellerIdentityUpload = createImageUpload(3).fields([
  { name: "id_card_front", maxCount: 1 },
  { name: "id_card_back", maxCount: 1 },
  { name: "selfie", maxCount: 1 },
  { name: "idCardFrontImage", maxCount: 1 },
  { name: "idCardBackImage", maxCount: 1 },
  { name: "selfieImage", maxCount: 1 },
]);

const productImagesUpload = createImageUpload(8).fields([
  { name: "images", maxCount: 8 },
  { name: "productImages", maxCount: 8 },
]);

const paymentProofUpload = createImageUpload(1).fields([
  { name: "paymentProof", maxCount: 1 },
  { name: "proof", maxCount: 1 },
]);

export type SellerIdentityUploadFiles = Partial<
  Record<
    "id_card_front" | "id_card_back" | "selfie" | "idCardFrontImage" | "idCardBackImage" | "selfieImage",
    Express.Multer.File[]
  >
>;

export type SellerIdentityUploadFileSet = {
  idCardFrontFile?: Express.Multer.File;
  idCardBackFile?: Express.Multer.File;
  selfieFile?: Express.Multer.File;
};

export type ProductImageUploadFiles = Partial<Record<"images" | "productImages", Express.Multer.File[]>>;
export type PaymentProofUploadFiles = Partial<Record<"paymentProof" | "proof", Express.Multer.File[]>>;

const runUpload = (
  uploadHandler: ReturnType<ReturnType<typeof createImageUpload>["fields"]>,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  uploadHandler(req, res, (err) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "Image file must be 5MB or smaller" : err.message;
      next(createError(message, 400));
      return;
    }

    next(err);
  });
};

export const uploadSellerIdentityImages = (req: Request, res: Response, next: NextFunction) => {
  runUpload(sellerIdentityUpload, req, res, next);
};

export const uploadProductImages = (req: Request, res: Response, next: NextFunction) => {
  runUpload(productImagesUpload, req, res, next);
};

export const uploadPaymentProofImage = (req: Request, res: Response, next: NextFunction) => {
  runUpload(paymentProofUpload, req, res, next);
};

export const getSellerIdentityUploadFiles = (files?: SellerIdentityUploadFiles): SellerIdentityUploadFileSet => ({
  idCardFrontFile: files?.id_card_front?.[0] ?? files?.idCardFrontImage?.[0],
  idCardBackFile: files?.id_card_back?.[0] ?? files?.idCardBackImage?.[0],
  selfieFile: files?.selfie?.[0] ?? files?.selfieImage?.[0],
});

export const getProductImageUploadFiles = (files?: ProductImageUploadFiles) => [
  ...(files?.productImages ?? []),
  ...(files?.images ?? []),
];

export const getPaymentProofUploadFile = (files?: PaymentProofUploadFiles) =>
  files?.paymentProof?.[0] ?? files?.proof?.[0];
