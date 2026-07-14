import { Types } from 'mongoose';
import { AppError } from '../../core/errors.js';
import { ExpenseModel, ReceiptModel, UserPreferenceModel } from '../../db/models.js';
import {
  OrphanedImageError,
  deleteImage,
  signedUrl,
  uploadImage,
} from '../../storage/imagekit.js';
import { isImageKitConfigured, type Env } from '../../config/env.js';
import type { AuthedUser } from '../../core/auth-guard.js';

/**
 * Receipt images.
 *
 * The bytes live in ImageKit; Mongo holds only the file id and path. Binary in the database
 * bloats every backup and drags megabytes through queries that never asked for it.
 *
 * Stored ONLY with the user's explicit consent (`storeReceipts`), off by default and asked
 * for the first time they attach one. The gate is enforced HERE, on the server — a client
 * that forgot to ask, or a future screen that never learned to, cannot store an image anyway.
 *
 * Note the deliberate asymmetry with food photos, which are sent to the model and dropped.
 * It comes down to what the image is FOR. A food photo is an input to an estimate: once the
 * calories are known the picture buys the user nothing, and a library of what someone eats
 * is a liability with no upside. A receipt is EVIDENCE — it is what you reach for when you
 * cannot remember what a ₹4,200 charge was. Keeping it is the point, so we keep it, and we
 * ask first.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export async function receiptsAllowed(userId: string): Promise<boolean> {
  const prefs = await UserPreferenceModel.findOne(
    { userId: new Types.ObjectId(userId) },
    { storeReceipts: 1 },
  ).lean();

  return prefs?.storeReceipts ?? false;
}

export async function attachReceipt(
  env: Env,
  user: AuthedUser,
  expenseId: string,
  image: { buffer: Buffer; contentType: string },
): Promise<{ byteSize: number }> {
  if (!isImageKitConfigured(env)) {
    throw AppError.aiUnavailable('Image storage is not configured on this server');
  }

  if (!(await receiptsAllowed(user.id))) {
    throw AppError.forbidden(
      'Receipt images are not being kept for this account. Turn on "Keep receipt images" to store them.',
    );
  }

  if (!ALLOWED.includes(image.contentType)) {
    throw AppError.badRequest(
      `Unsupported image type "${image.contentType}". Use JPEG, PNG, WebP, or HEIC.`,
    );
  }

  if (image.buffer.byteLength > MAX_BYTES) {
    throw AppError.badRequest('That image is too large. Receipts are capped at 5 MB.');
  }

  const expense = await ExpenseModel.findOne({
    _id: new Types.ObjectId(expenseId),
    userId: new Types.ObjectId(user.id),
  });

  if (!expense) throw AppError.notFound('Expense');

  const uploaded = await uploadImage(
    env,
    { buffer: image.buffer, fileName: `${expenseId}.jpg`, contentType: image.contentType },
    // Foldered per user, so an accidental listing can never mix one person's receipts
    // into another's.
    `/receipts/${user.id}`,
  );

  // Replacing a receipt must not leave the old image behind, stored and forgotten.
  const previous = await ReceiptModel.findOne({
    userId: new Types.ObjectId(user.id),
    expenseId: expense._id,
  }).lean();

  await ReceiptModel.findOneAndUpdate(
    { userId: new Types.ObjectId(user.id), expenseId: expense._id },
    {
      $set: {
        fileId: uploaded.fileId,
        filePath: uploaded.filePath,
        contentType: image.contentType,
        byteSize: uploaded.byteSize,
      },
    },
    { upsert: true },
  );

  if (previous?.fileId) {
    // An orphan at ImageKit is not worth failing the user's upload over.
    await deleteImage(env, previous.fileId).catch(() => undefined);
  }

  expense.hasReceipt = true;
  await expense.save();

  return { byteSize: uploaded.byteSize };
}

export interface ReceiptLink {
  url: string;
  expiresAt: Date;
}

/**
 * A short-lived signed URL, minted per request.
 *
 * The image is never streamed through this API — that would push every receipt byte through
 * our bandwidth for no benefit. But the URL is signed and expires, so one that leaks into a
 * log or a share sheet stops working rather than being a permanent window into someone's
 * spending.
 */
export async function receiptLink(
  env: Env,
  userId: string,
  expenseId: string,
): Promise<ReceiptLink> {
  const receipt = await ReceiptModel.findOne({
    userId: new Types.ObjectId(userId),
    expenseId: new Types.ObjectId(expenseId),
  }).lean();

  if (!receipt) throw AppError.notFound('Receipt');

  return signedUrl(env, receipt.filePath);
}

export async function deleteReceipt(
  env: Env,
  userId: string,
  expenseId: string,
): Promise<void> {
  const receipt = await ReceiptModel.findOneAndDelete({
    userId: new Types.ObjectId(userId),
    expenseId: new Types.ObjectId(expenseId),
  }).lean();

  await ExpenseModel.updateOne(
    { _id: new Types.ObjectId(expenseId), userId: new Types.ObjectId(userId) },
    { $set: { hasReceipt: false } },
  );

  if (!receipt?.fileId) return;

  /**
   * The local record is already gone. If the remote delete fails we log an orphan rather
   * than resurrect it — a user asking us to forget an image must not be told "no" because
   * a third party was having a bad day.
   */
  await deleteImage(env, receipt.fileId).catch((err: unknown) => {
    if (err instanceof OrphanedImageError) {
      console.error(err.message);
      return;
    }
    throw err;
  });
}

/**
 * Turning the setting off deletes everything already stored — locally AND remotely.
 *
 * A privacy toggle that only stops future collection while quietly keeping what it already
 * took is not a privacy toggle. "Off" has to mean the images are gone.
 */
export async function purgeAllReceipts(env: Env, userId: string): Promise<number> {
  const receipts = await ReceiptModel.find({ userId: new Types.ObjectId(userId) }).lean();

  await ReceiptModel.deleteMany({ userId: new Types.ObjectId(userId) });
  await ExpenseModel.updateMany(
    { userId: new Types.ObjectId(userId), hasReceipt: true },
    { $set: { hasReceipt: false } },
  );

  for (const receipt of receipts) {
    if (!receipt.fileId) continue;
    await deleteImage(env, receipt.fileId).catch((err: unknown) => {
      if (err instanceof OrphanedImageError) console.error(err.message);
    });
  }

  return receipts.length;
}
