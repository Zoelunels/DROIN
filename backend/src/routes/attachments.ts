import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { pool } from "../db";
import { HttpError } from "../errors";
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  removeStoredFiles,
  saveUpload,
  storedPath,
} from "../services/attachments";
import { parseId } from "../validate";

// Receipt photos/PDFs attached to a transaction.
//   POST   /transactions/:id/attachments   multipart/form-data, field "file"
//   GET    /transactions/:id/attachments
//   GET    /attachments/:id                the file itself (needs the Authorization header too)
//   DELETE /attachments/:id
export const transactionAttachmentsRouter = new Hono<AppEnv>();
export const attachmentsRouter = new Hono<AppEnv>();

const COLUMNS = "id, transaction_id, original_name, mime_type, size_bytes, created_at";

async function assertOwnTransaction(userId: number, transactionId: number) {
  const { rows } = await pool.query("SELECT origin FROM transactions WHERE id = $1 AND user_id = $2", [
    transactionId,
    userId,
  ]);
  if (rows.length === 0) throw new HttpError(404, "Transaction not found");
  return rows[0];
}

transactionAttachmentsRouter.get("/:id/attachments", async (c) => {
  const userId = c.get("user").id;
  const transactionId = parseId(c.req.param("id"));
  await assertOwnTransaction(userId, transactionId);
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM attachments WHERE transaction_id = $1 ORDER BY id`,
    [transactionId],
  );
  return c.json(rows);
});

// The request size itself is capped by the global bodyLimit in app.ts; the file size is checked below.
transactionAttachmentsRouter.post(
  "/:id/attachments",
  async (c) => {
    const userId = c.get("user").id;
    const transactionId = parseId(c.req.param("id"));
    const tx = await assertOwnTransaction(userId, transactionId);
    // Receipts belong to real purchases; transfer/debt rows are deleted together with their
    // parent, which would leave files behind on disk.
    if (tx.origin !== "manual") {
      throw new HttpError(400, "Receipts can only be attached to income/expense transactions");
    }

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw new HttpError(400, "Send the file as multipart/form-data in a field named \"file\"");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Send the file in a field named \"file\"");
    if (!ALLOWED_MIME_TYPES[file.type]) {
      throw new HttpError(415, `Unsupported file type. Allowed: ${Object.keys(ALLOWED_MIME_TYPES).join(", ")}`);
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "File is too large (max 5 MB)");

    const storedName = await saveUpload(file);
    try {
      const { rows } = await pool.query(
        `INSERT INTO attachments (user_id, transaction_id, stored_name, original_name, mime_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
        [userId, transactionId, storedName, (file.name || "receipt").slice(0, 255), file.type, file.size],
      );
      await pool.query("UPDATE transactions SET updated_at = now() WHERE id = $1", [transactionId]);
      return c.json(rows[0], 201);
    } catch (err) {
      await removeStoredFiles([storedName]);
      throw err;
    }
  },
);

attachmentsRouter.get("/:id", async (c) => {
  const { rows } = await pool.query("SELECT * FROM attachments WHERE id = $1 AND user_id = $2", [
    parseId(c.req.param("id")),
    c.get("user").id,
  ]);
  const attachment = rows[0];
  if (!attachment) throw new HttpError(404, "Attachment not found");
  const file = Bun.file(storedPath(attachment.stored_name));
  if (!(await file.exists())) throw new HttpError(404, "The file for this attachment is missing");
  return new Response(file, {
    headers: {
      "Content-Type": attachment.mime_type,
      "Content-Disposition": `inline; filename="${attachment.original_name.replace(/["\\\r\n]/g, "_")}"`,
      "Cache-Control": "private, max-age=86400",
    },
  });
});

attachmentsRouter.delete("/:id", async (c) => {
  const { rows } = await pool.query(
    "DELETE FROM attachments WHERE id = $1 AND user_id = $2 RETURNING stored_name, transaction_id",
    [parseId(c.req.param("id")), c.get("user").id],
  );
  if (rows.length === 0) throw new HttpError(404, "Attachment not found");
  await pool.query("UPDATE transactions SET updated_at = now() WHERE id = $1", [rows[0].transaction_id]);
  await removeStoredFiles([rows[0].stored_name]);
  return c.body(null, 204);
});
