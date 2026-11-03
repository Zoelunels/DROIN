import { describe, expect, test } from "bun:test";
import { inflateRawSync } from "node:zlib";
import { app } from "../src/app";
import { buildXlsx } from "../src/xlsx";
import { addDays } from "../src/time";
import { newUser, today } from "./helpers";

// Reads a zip back into { name: text } using its central directory, so tests can look inside the .xlsx.
function unzip(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  expect(end).toBeGreaterThanOrEqual(0);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const packed = bytes.subarray(dataStart, dataStart + size);
    const raw = method === 8 ? inflateRawSync(packed) : packed;
    expect(Bun.hash.crc32(raw)).toBe(crc);
    files[name] = new TextDecoder().decode(raw);
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return files;
}

async function download(token: string, query = "") {
  const res = await app.request(`/export/transactions.xlsx${query}`, { headers: { Authorization: `Bearer ${token}` } });
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
}

describe("xlsx writer", () => {
  test("produces a valid zip with the parts Excel needs", () => {
    const files = unzip(buildXlsx("Sheet", [{ header: "A", width: 10 }], [["x"]]));
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  test("escapes XML and keeps formula-looking text as text", () => {
    const sheet = unzip(buildXlsx("S", [{ header: "Note", width: 10 }], [['=HYPERLINK("x") <b>&']]))["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain("=HYPERLINK(&quot;x&quot;) &lt;b&gt;&amp;");
    expect(sheet).not.toContain("<f>");
  });

  test("dates become Excel day numbers, past column Z works", () => {
    const columns = Array.from({ length: 28 }, (_, i) => ({ header: `C${i}`, width: 5 }));
    const row = Array.from({ length: 28 }, () => null as null | { date: string });
    row[27] = { date: "2026-10-20" };
    const sheet = unzip(buildXlsx("S", columns, [row]))["xl/worksheets/sheet1.xml"]!;
    // 2026-10-20 is day 46315 counting from 1899-12-30; column 28 is "AB".
    expect(sheet).toContain('<c r="AB2" s="2"><v>46315</v></c>');
  });
});

describe("GET /export/transactions.xlsx", () => {
  test("exports the user's transactions with In/Out and signed amounts", async () => {
    const u = await newUser();
    const cash = await u.wallet("Cash", 1_000_000);
    await u.spend(cash.id, 25_000, { note: "makan siang", transaction_date: addDays(today(), -1) });
    await u.call("POST", "/transactions", {
      wallet_id: cash.id, category_id: u.category("Salary"), type: "income", amount: 8_000_000,
      transaction_date: today(), note: "gaji",
    });

    const { res, bytes } = await download(u.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("Content-Disposition")).toContain("droin-transactions.xlsx");

    const sheet = unzip(bytes)["xl/worksheets/sheet1.xml"]!;
    for (const header of ["Date", "Type", "Category", "Wallet", "Note", "Amount"]) expect(sheet).toContain(`>${header}<`);
    expect(sheet).toContain(">makan siang<");
    expect(sheet).toContain("<v>-25000</v>"); // Out is negative
    expect(sheet).toContain("<v>8000000</v>"); // In is positive
    expect(sheet).toContain(">Out<");
    expect(sheet).toContain(">In<");
    // Header + the wallet's opening balance (stored as an In entry, so SUM(Amount) is the real balance) + 2.
    expect(sheet.match(/<row /g)!.length).toBe(1 + 3);
    expect(sheet).toContain("<v>1000000</v>");
  });

  test("filters by type and search, and never shows another user's data", async () => {
    const u = await newUser();
    const other = await newUser();
    const w = await u.wallet("Cash", 0);
    const ow = await other.wallet("Cash", 0);
    await u.spend(w.id, 10_000, { note: "kopi pagi" });
    await u.spend(w.id, 20_000, { note: "bensin" });
    await other.spend(ow.id, 99_000, { note: "kopi rahasia" });

    const kopi = unzip((await download(u.token, "?q=kopi&type=expense")).bytes)["xl/worksheets/sheet1.xml"]!;
    expect(kopi).toContain(">kopi pagi<");
    expect(kopi).not.toContain("bensin");
    expect(kopi).not.toContain("rahasia");

    const income = unzip((await download(u.token, "?type=income")).bytes)["xl/worksheets/sheet1.xml"]!;
    expect(income.match(/<row /g)!.length).toBe(1); // header only
  });

  test("rejects bad filters and needs a login", async () => {
    const u = await newUser();
    expect((await download(u.token, "?type=nope")).res.status).toBe(400);
    expect((await download(u.token, "?from=yesterday")).res.status).toBe(400);
    expect((await app.request("/export/transactions.xlsx")).status).toBe(401);
  });
});

describe("category icons", () => {
  test("accept one emoji or an icon key, reject anything else", async () => {
    const u = await newUser();
    for (const icon of ["🍜", "👩‍💻", "👍🏽", "🇮🇩", "❤️", "utensils"]) {
      const res = await u.call("POST", "/categories", { name: `Cat ${icon}`, type: "expense", icon });
      expect(res.status).toBe(201);
      expect(res.data.icon).toBe(icon);
    }
    for (const icon of ["two words", "🍜🍜", "Utensils", "<script>", "a".repeat(60)]) {
      expect((await u.call("POST", "/categories", { name: `Bad ${icon}`, type: "expense", icon })).status).toBe(400);
    }
  });
});
