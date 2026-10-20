import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
// Bun can import YAML directly. Because it is imported, `bun --watch` also restarts on changes
// to this file (reading it with Bun.file would not).
import openapiSpec from "../openapi.yaml";
import { requireAuth, type AppEnv } from "./auth";
import { pool } from "./db";
import { HttpError, errorHandler } from "./errors";
import { idempotency } from "./idempotency";
import { attachmentsRouter, transactionAttachmentsRouter } from "./routes/attachments";
import { authRouter } from "./routes/auth";
import { budgetsRouter } from "./routes/budgets";
import { categoriesRouter } from "./routes/categories";
import { debtsRouter } from "./routes/debts";
import { exportRouter } from "./routes/export";
import { goalsRouter } from "./routes/goals";
import { insightsRouter, quickInputRouter } from "./routes/insights";
import { notificationsRouter } from "./routes/notifications";
import { recurringRouter } from "./routes/recurring";
import { reportsRouter } from "./routes/reports";
import { syncRouter } from "./routes/sync";
import { tagsRouter } from "./routes/tags";
import { transactionsRouter } from "./routes/transactions";
import { transfersRouter } from "./routes/transfers";
import { walletsRouter } from "./routes/wallets";

// strict: false → "/docs/" and "/docs" are treated the same (Hono distinguishes them by default).
export const app = new Hono<AppEnv>({ strict: false });

// Log every request in the terminal (method, path, status, duration) — handy when debugging from mobile.
if (process.env.NODE_ENV !== "test") app.use(logger());

// Needed when the app runs in a browser (Expo web). Native apps do not use CORS.
app.use(cors({ origin: "*", exposeHeaders: ["X-Total-Count", "Idempotency-Replayed", "Content-Disposition"] }));

// No request needs to be bigger than a receipt upload.
app.use(
  bodyLimit({
    maxSize: 6 * 1024 * 1024,
    onError: () => {
      throw new HttpError(413, "Request is too large");
    },
  }),
);

// The OpenAPI spec is written by hand in openapi.yaml — update it whenever an endpoint changes.
app.get("/openapi.json", (c) => c.json(openapiSpec));
app.get("/docs", swaggerUI({ url: "/openapi.json", persistAuthorization: true }));
app.get("/", (c) => c.redirect("/docs"));

app.get("/health", async (c) => {
  const { rows } = await pool.query("SELECT now() AS db_time");
  return c.json({ status: "ok", dbTime: rows[0].db_time });
});

// /auth/register and /auth/login are public; the router protects its own other routes.
app.route("/auth", authRouter);

// Everything else needs a logged-in user. Idempotency runs after auth because keys are per user.
const protectedRoutes: [string, Hono<AppEnv>][] = [
  ["/wallets", walletsRouter],
  ["/categories", categoriesRouter],
  ["/transactions", transactionsRouter],
  ["/transactions", transactionAttachmentsRouter],
  ["/attachments", attachmentsRouter],
  ["/transfers", transfersRouter],
  ["/reports", reportsRouter],
  ["/budgets", budgetsRouter],
  ["/recurring", recurringRouter],
  ["/goals", goalsRouter],
  ["/debts", debtsRouter],
  ["/tags", tagsRouter],
  ["/insights", insightsRouter],
  ["/quick-input", quickInputRouter],
  ["/export", exportRouter],
  ["/sync", syncRouter],
  ["/notifications", notificationsRouter],
];
for (const path of new Set(protectedRoutes.map(([p]) => p))) {
  app.use(`${path}/*`, requireAuth, idempotency);
}
for (const [path, router] of protectedRoutes) app.route(path, router);

app.notFound((c) => c.json({ error: "Endpoint not found" }, 404));
app.onError(errorHandler);
