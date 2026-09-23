import nodemailer from "nodemailer";

interface SendOtpEmailParams {
  to: string;
  name: string;
  otp: string;
}

interface SellerReviewEmailParams {
  to: string;
  name: string;
  shopName: string;
  approved: boolean;
  reason?: string;
}

class OtpEmailError extends Error {
  statusCode = 500;
  isOperational = true;

  constructor() {
    super("Unable to send OTP email");
  }
}

const createOtpEmailError = (): OtpEmailError => new OtpEmailError();

const sendNonCriticalEmail = async ({
  to,
  subject,
  text,
  html,
  logLabel,
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
  logLabel: string;
}): Promise<void> => {
  const transporter = getTransporter();

  if (!transporter) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[${logLabel} SKIPPED] SMTP config is missing. to=${to}`);
    }
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: getFromAddress(),
      to,
      subject,
      text,
      html,
    });

    console.log(`[${logLabel} SENT] to=${to} messageId=${info.messageId}`);
  } catch (err) {
    console.error(`[${logLabel} ERROR]`, err);
  }
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const getTransporter = () => {
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const secureRaw = process.env.SMTP_SECURE?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim().replace(/\s+/g, "");
  const isConfigured = Boolean(host && portRaw && secureRaw && user && pass);

  if (!isConfigured) return null;

  return nodemailer.createTransport({
    host,
    port: Number(portRaw),
    secure: secureRaw === "true",
    auth: { user: user!, pass: pass! },
  });
};

const getFromAddress = (): string => {
  const configuredFrom = process.env.SMTP_FROM?.trim();
  const smtpUser = process.env.SMTP_USER?.trim();

  if (!configuredFrom) return `REWORE <${smtpUser}>`;

  const hasAngleAddress = /<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>/.test(configuredFrom);
  if (hasAngleAddress) return configuredFrom;

  const emailMatch = configuredFrom.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!emailMatch) return configuredFrom;

  const displayName = configuredFrom.replace(emailMatch[0], "").trim() || "REWORE";
  return `${displayName} <${emailMatch[0]}>`;
};

export const sendOtpEmail = async ({ to, name, otp }: SendOtpEmailParams): Promise<void> => {
  const transporter = getTransporter();

  if (!transporter) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[EMAIL OTP ERROR] SMTP config is missing. Set SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS.");
      console.log(`[DEV OTP] ${to}: ${otp}`);
    }

    throw createOtpEmailError();
  }

  const from = getFromAddress();
  const safeName = escapeHtml(name);
  const sanitizedPassLength = process.env.SMTP_PASS?.trim().replace(/\s+/g, "").length;

  if (
    process.env.NODE_ENV !== "production" &&
    process.env.SMTP_HOST?.trim() === "smtp.gmail.com" &&
    sanitizedPassLength &&
    sanitizedPassLength !== 16
  ) {
    console.warn(`[EMAIL OTP WARNING] Gmail App Password should be 16 characters after removing spaces. Current length=${sanitizedPassLength}.`);
  }

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject: "Your REWORE verification code",
      text: `Hi ${name}, your REWORE verification code is ${otp}. This code expires in 5 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #231a11;">
          <h2>Verify your REWORE account</h2>
          <p>Hi ${safeName},</p>
          <p>Your verification code is:</p>
          <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">${otp}</p>
          <p>This code expires in 5 minutes.</p>
        </div>
      `,
    });

    console.log(`[EMAIL OTP SENT] to=${to} messageId=${info.messageId}`);
  } catch (err) {
    console.error("[EMAIL OTP ERROR]", err);
    throw createOtpEmailError();
  }
};

export const sendSellerReviewResultEmail = async ({
  to,
  name,
  shopName,
  approved,
  reason,
}: SellerReviewEmailParams): Promise<void> => {
  const safeName = escapeHtml(name);
  const safeShopName = escapeHtml(shopName);
  const safeReason = escapeHtml(reason || "Your seller profile did not meet REWORE verification requirements.");

  await sendNonCriticalEmail({
    to,
    subject: approved ? "Your REWORE seller profile is approved" : "Your REWORE seller profile was rejected",
    text: approved
      ? `Hi ${name}, your seller profile for ${shopName} has been approved.`
      : `Hi ${name}, your seller profile for ${shopName} was rejected. Reason: ${reason || "Verification requirements not met."}`,
    html: approved
      ? `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #231a11;">
          <h2>Seller profile approved</h2>
          <p>Hi ${safeName},</p>
          <p>Your seller profile for <strong>${safeShopName}</strong> has been approved.</p>
          <p>You can now use seller features on REWORE.</p>
        </div>
      `
      : `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #231a11;">
          <h2>Seller profile rejected</h2>
          <p>Hi ${safeName},</p>
          <p>Your seller profile for <strong>${safeShopName}</strong> was rejected.</p>
          <p><strong>Reason:</strong> ${safeReason}</p>
        </div>
      `,
    logLabel: "SELLER REVIEW EMAIL",
  });
};
