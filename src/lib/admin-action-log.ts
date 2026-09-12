import { Prisma } from ".prisma/client";

export type AdminActionLogInput = {
  adminId: string;
  actionType: string;
  targetType: string;
  targetId: string;
  note?: string;
};

export const createAdminActionLog = (
  tx: Prisma.TransactionClient,
  { adminId, actionType, targetType, targetId, note }: AdminActionLogInput
) =>
  tx.adminActionLog.create({
    data: {
      adminId,
      actionType,
      targetType,
      targetId,
      note,
    },
  });
