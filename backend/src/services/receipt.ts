// Turns the OCR text of a shop receipt (struk) or an invoice (faktur / tagihan) into the parts a
// transaction needs: the total, the date, the shop name and how it was paid. Rule-based, written for
// Indonesian receipts (Indomaret, Alfamart, cafés, restaurants, SPBU) and invoices (marketplaces,
// PLN/Telkom bills, service invoices), with English ones as a bonus. OCR text is noisy, so every rule
// is forgiving and anything unsure comes back as null for the user to fill in.

export interface ReceiptItem {
  name: string;
  amount: number; // the line's amount (quantity × price), as printed
}

export interface ReceiptInfo {
  kind: "receipt" | "invoice";
  total: number | null;
  date: string | null; // YYYY-MM-DD
  merchant: string | null;
  payment: string | null; // e.g. "QRIS", "GoPay", "Cash", "BCA"
  items: ReceiptItem[]; // what was bought, line by line (empty when the receipt doesn't list them)
}

// OCR also swaps look-alike characters inside words: "T0TAL", "TUNAl", "KEMBAL1", "IND0MIE". In a
// token that is mostly letters, digits that look like letters become letters, and the labels the
// parser looks for are put back together, so a misread label still counts.
const WORD_LOOKALIKE: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B" };
const LABEL_FIXES: [RegExp, string][] = [
  [/\b[T7][O0][T7][A4][LI1|]\b/gi, "TOTAL"],
  [/\bTUNA[IL1|]\b/gi, "TUNAI"],
  [/\bKEMBA[LI1|][I1L|](AN)?\b/gi, "KEMBALI$1"],
  [/\bBAYAR\b/gi, "BAYAR"],
];
export function repairWords(line: string): string {
  let out = line.replace(/[\p{L}\d|]{3,}/gu, (token) => {
    const letters = (token.match(/\p{L}/gu) ?? []).length;
    const digits = (token.match(/\d/g) ?? []).length;
    // Only a lone digit inside a word is a misread letter ("IND0MIE", "KEMBAL1"); a run of digits is
    // real ("MOD500ML", "AQUA600"), so "500ML" stays as it is.
    return digits > 0 && letters > digits && letters >= 3 ? token.replace(/(?<!\d)[0158](?!\d)/g, (d) => WORD_LOOKALIKE[d]!) : token;
  });
  for (const [re, fixed] of LABEL_FIXES) out = out.replace(re, (m, ...groups) => fixed.replace("$1", typeof groups[0] === "string" ? groups[0] : ""));
  return repairLabels(out);
}

// The labels the totals depend on, as OCR mangles them on faded or cut-off receipts: "lunai" (Tunai),
// "Kerbal ian" (Kembalian), "tal Belania" (Total Belanja, the photo cut off the left edge), "Iten".
// Only these distinctive words are mended fuzzily; everyday words that look alike ("bayar"/"bayam",
// "harga") must match exactly, or an item like "BAYAM 1 5.000" would turn into a payment.
const FUZZY_LABELS = ["total", "subtotal", "tunai", "kembalian", "kembali", "belanja", "diskon", "potongan", "tagihan", "item", "disc"];

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/** The label a mangled word stands for, or null. `atStart`: the word begins the line, where a photo
 *  that cut off the left edge leaves only the end of it ("tal" for total, "mbalian" for kembalian). */
export function labelFor(word: string, atStart: boolean): string | null {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length < 3) return null;
  if (FUZZY_LABELS.includes(w)) return w;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const label of FUZZY_LABELS) {
    // How many letters may be wrong: 2 in long words, 1 in five-letter ones; four-letter labels
    // only with the first letter right ("iten" → item), so short words don't match by accident.
    const allowed = label.length >= 7 ? 2 : label.length >= 5 ? 1 : w.length === 4 && w[0] === label[0] ? 1 : 0;
    const d = editDistance(w, label);
    if (d <= allowed && d < bestDistance) {
      best = label;
      bestDistance = d;
    }
  }
  if (best) return best;
  if (atStart) return FUZZY_LABELS.find((label) => label.length > w.length && label.endsWith(w) && w.length * 2 >= label.length) ?? null;
  return null;
}

/**
 * Mends mangled label words on lines that look like a summary row: a short label then one amount
 * ("lunai 100,000", "tal Belania 69.900"). Item rows, with a quantity and prices, are left alone.
 */
function repairLabels(line: string): string {
  // Where the first word with a digit starts ("TOTAL B0.100": at "B0.100", not inside it).
  const firstNumber = line.search(/[^\s]*\d/);
  const label = firstNumber === -1 ? line : line.slice(0, firstNumber);
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3 || firstNumber === -1) return line;
  // One amount, optionally after an item count ("Total Item 3 81,200").
  const numbers = line.slice(firstNumber).match(/\d[\d.,]*/g) ?? [];
  if (numbers.length > 2 || (numbers.length === 2 && !/^\d{1,3}$/.test(numbers[0]!))) return line;

  const fixed: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    // OCR sometimes splits a word: "Kerbal ian" → kembalian.
    const joined = i + 1 < words.length ? labelFor(word + words[i + 1], i === 0) : null;
    const single = labelFor(word, i === 0);
    if (!single && joined) {
      fixed.push(joined);
      i++;
    } else fixed.push(single ?? word);
  }
  return fixed.join(" ") + " " + line.slice(firstNumber);
}

// Money as printed on receipts: 40.000 · 40,000 · 1.250.000 · 63.800,00 · Rp 25.000 · Rp25000 · 45000.
// Not money: a number glued to letters ("B0.100" is a misread 80.100, "KASIR01"), the tail of a longer
// number, or a long bare digit run. Dates (20251026), bill/reference numbers (230512345) and barcodes
// have no thousand separators, so a bare run only counts up to 6 digits (Rp 999.999).
const MONEY = /(?<![\p{L}\d.,])(rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{4,6}(?:[.,]\d{1,2})?)(?![\d])/giu;

// Thermal receipts are faded and OCR swaps look-alike characters inside numbers ("B0.1OO", "8O.l00")
// and splits groups ("80, 100"). Inside something that is clearly a number (has a separator), letters
// that look like digits are turned back into digits; stray spaces after a separator are closed up.
const LOOKALIKE: Record<string, string> = { O: "0", o: "0", D: "0", B: "8", I: "1", l: "1", "|": "1", S: "5", Z: "2" };
//
// PaddleOCR reads a row's columns as one box when they are close and drops the space between them:
// "4.000 8.000" → "4.0008.000", "21.150 42.300" → "21.15042.300". A thousands group is always exactly
// three digits, so digits running on after one start the next number: split there.
export function repairNumbers(line: string): string {
  return line
    .replace(/(\d[.,]\d{3})(?=\d{1,3}[.,]\d{3})/g, "$1 ")
    .replace(/(\d[.,])\s+(?=\d{3}(?!\d))/g, "$1")
    .replace(/(^|\s|[Rr][Pp]\.?)([\dOoDBIl|SZ]{1,3}(?:[.,][\dOoDBIl|SZ]{3})+(?:[.,][\dOo]{1,2})?)(?=\s|$|[^\p{L}\d])/gu, (m, before: string, token: string) =>
      (token.match(/\d/g) ?? []).length >= 2 ? before + token.replace(/[OoDBIl|SZ]/g, (ch) => LOOKALIKE[ch]!) : m,
    );
}

interface Amount {
  value: number;
  at: number; // where it starts in the line
}

function toNumber(raw: string): number | null {
  let s = raw;
  const decimals = /[.,](\d{1,2})$/.exec(s);
  let cents = 0;
  // A trailing ",00" / ".50" is decimals only when the rest has thousand separators or 4+ digits.
  if (decimals && (/[.,]\d{3}[.,]\d{1,2}$/.test(s) || /^\d{4,}[.,]\d{1,2}$/.test(s))) {
    cents = Number(decimals[1]!.padEnd(2, "0")) / 100;
    s = s.slice(0, decimals.index);
  }
  const value = Number(s.replace(/[.,]/g, "")) + cents;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function amountsIn(line: string): Amount[] {
  const out: Amount[] = [];
  for (const m of line.matchAll(MONEY)) {
    // Amounts never start with 0: "0812…" is a phone number, "0841" a time.
    if (m[2]!.startsWith("0")) continue;
    const value = toNumber(m[2]!);
    if (value !== null) out.push({ value, at: m.index });
  }
  return out;
}

const values = (line: string) => amountsIn(line).map((a) => a.value);

// Lines that look like totals, best first. Each rank also lists what to skip (sub totals, item counts…).
// The first rank is what was finally owed (after discounts, shipping and tax); "total harga" or
// "total belanja" on an invoice can be before a discount, so they only count when nothing better is there.
const TOTAL_RANKS: RegExp[] = [
  /\b(grand\s*total|total\s*(bayar|tagihan|pembayaran|akhir|due|amount\s*due)|jumlah\s*(bayar|tagihan|yang\s*harus\s*dibayar)|(amount|balance)\s*due|net\s*total|sisa\s*tagihan|total\s*yang\s*harus\s*dibayar)\b/i,
  // "Belanja" on its own: the "Total" in front was cut off or misread ("lola] Belanja 18,200").
  /\b(total\s*(belanja|harga|invoice|pesanan|amount)|invoice\s*total|belanja)\b/i,
  /\b(total|jumlah|tagihan|netto|nett?|amount)\b/i,
];
const NOT_TOTAL = /\b(sub\s*-?\s*total|total\s*(item|qty|jml|diskon|disc|discount|hemat|potongan|ppn|pajak|tax|poin|point|ongkos|ongkir|shipping|berat|weight|produk|barang)|qty|kembali(an)?|change|hemat|amount\s*paid|paid\s*amount|selamat\s*belanja)\b/i;
// "TOTAL ITEM 3   81,200" even when "ITEM" is misread ("lotal ten 3 81,200"): a total label, a small
// count, then an amount. That is the price before discounts, not the bill.
const ITEM_COUNT_ROW = /\btotal\b[^\d]{0,12}\s\d{1,3}\s+(rp\.?\s*)?\d{1,3}[.,]\d{3}/i;
// "QRIS CPM ALFA" is how Alfamart prints a QRIS payment; on a cut-off photo only "CPM ALFA" is left.
const PAID = /\b(tunai|cash|bayar|dibayar|qris|cpm|debit|kredit|credit|gopay|ovo|dana|shopee\s*pay|linkaja|edc|card)\b/i;
const CHANGE = /\b(kembali(an)?|change)\b/i;
const NOT_MONEY_LINE = /\b(npwp|telp|tel|phone|hp|no\.?\s*(trx|transaksi|struk|nota|ref|invoice|faktur|pesanan|pelanggan|meter|tagihan|rekening|va)|ref|kasir|cashier|member|kartu\s*no|nik|inv\/|invoice\s*(no|number|#)|nomor\s*(invoice|tagihan|pesanan|pelanggan)|order\s*(id|no|number)|id\s*pelanggan|customer\s*(id|no))\b/i;
// Lines about when an invoice must be paid, not when the purchase happened.
const DUE_LINE = /\b(jatuh\s*tempo|due\s*date|due\s*by|pay\s*by|batas\s*(waktu\s*)?pembayaran|bayar\s*sebelum|berlaku\s*(hingga|sampai)|valid\s*until|expire[sd]?)\b/i;
const DATE_LABEL = /\b(tgl|tanggal|date|invoice\s*date|tanggal\s*(invoice|faktur|transaksi|pembelian|pesanan)|issued|dated|waktu)\b/i;

const TAX_OR_DISCOUNT = /\b(ppn|pajak|tax|pb1|pbi|service|svc|diskon|disc|discount|potongan|promo|voucher)\b/i;
// A label that is really a reference: "No. Tagihan 230512345", "ID Pelanggan", "Kode Bayar".
const REFERENCE_BEFORE = /\b(no|nomor|nmr|id|kode|code|ref)\.?\s*[:#]?\s*$/i;
// A line that holds nothing but an amount, as when OCR puts "GRAND TOTAL" and "63.800" on two lines.
const AMOUNT_ONLY = /^[\s:=]*(rp\.?\s*)?[\d.,]+\s*$/i;

/** The amount printed for a total label on this line ("TOTAL : 80.100"), if the line has one. */
function totalOnLine(line: string, next: string | undefined, rank: RegExp): number | null {
  for (const m of line.matchAll(new RegExp(rank.source, "gi"))) {
    const start = m.index;
    const end = start + m[0].length;
    // "TOTAL ITEM 6", "Sub Total", "Total Diskon"… are not the total; neither is "No. Tagihan".
    if (NOT_TOTAL.test(line.slice(Math.max(0, start - 8), end + 12)) || ITEM_COUNT_ROW.test(line.slice(start))) continue;
    if (REFERENCE_BEFORE.test(line.slice(0, start))) continue;
    // The amount right after the label: "TOTAL 80.100 DISKON 10.100" is 80.100, not the last number.
    const after = amountsIn(line).find((a) => a.at >= end);
    if (after) return after.value;
    // Label on its own line: the next line counts only if it is just an amount (not "PPN 10.100").
    if (next !== undefined && AMOUNT_ONLY.test(next)) return values(next)[0] ?? null;
  }
  return null;
}

/** The total from the labelled lines, best label first ("GRAND TOTAL" over "TOTAL"), and its rank. */
function labelledTotal(lines: string[]): { value: number; rank: number } | null {
  for (let rank = 0; rank < TOTAL_RANKS.length; rank++) {
    const found = lines.map((line, i) => totalOnLine(line, lines[i + 1], TOTAL_RANKS[rank]!)).filter((v): v is number => v !== null);
    // Several lines of the same rank (a total repeated in the footer): the one printed most often wins,
    // then the largest. One stray number can't outvote the real total printed twice.
    if (found.length > 0) return { value: mostSupported(found, lines), rank };
  }
  return null;
}

// The price before discounts ("TOTAL ITEM 3  81,200", "SUBTOTAL", "HARGA JUAL") and the discounts.
const GROSS = /\b(total\s*item|sub\s*-?\s*total|total\s*harga|harga\s*jual)\b/i;
const DISCOUNT_TOTAL = /\b(total\s*(disc|diskon|discount|potongan|hemat)|anda\s*hemat)\b/i;
// A discount row: an amount with a minus sign ("Disc. -3,000", "POTONGAN -Rp1.200").
const NEGATIVE = /(^|\s)-\s*(rp\.?\s*)?\d/i;

/**
 * What the receipt's own arithmetic says the bill is: price before discounts minus the discounts.
 * Supermarket receipts print all three ("Total Item 81,200 · Total Disc. 3,000 · Total Belanja 78,200"),
 * so this checks the total, and stands in for it when its label was lost. Null without both parts.
 */
function grossMinusDiscount(lines: string[]): number | null {
  const grossLine = lines.find((l) => (GROSS.test(l) || ITEM_COUNT_ROW.test(l)) && !DISCOUNT_TOTAL.test(l) && amountsIn(l).length > 0);
  if (!grossLine) return null;
  const gross = amountsIn(grossLine).at(-1)!.value;
  const discount = discountOf(lines);
  if (!discount || discount >= gross) return null;
  return round2(gross - discount);
}

/** The receipt's discounts: its "Total Disc." line, else the minus amounts added up. */
function discountOf(lines: string[]): number {
  const discountLine = lines.find((l) => DISCOUNT_TOTAL.test(l) && amountsIn(l).length > 0);
  if (discountLine) return amountsIn(discountLine).at(-1)!.value;
  return lines.filter((l) => NEGATIVE.test(l) && !CHANGE.test(l)).reduce((sum, l) => sum + (amountsIn(l).at(-1)?.value ?? 0), 0);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Two amounts that differ in exactly one digit: one is likely the other, misread ("18,200" / "78,200"). */
function oneDigitApart(a: number, b: number): boolean {
  const x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diff++;
  return diff === 1;
}

/** An amount that could be a misreading of another: one digit wrong, or one dropped ("2,800" for 21,800). */
function nearlyEqual(a: number, b: number): boolean {
  return editDistance(String(a), String(b)) <= 1;
}

/** How many lines of the receipt print this exact amount. */
function support(value: number, lines: string[]): number {
  return lines.filter((l) => values(l).includes(value)).length;
}

function mostSupported(candidates: number[], lines: string[]): number {
  return [...new Set(candidates)].sort((a, b) => support(b, lines) - support(a, lines) || b - a)[0]!;
}

const CASH = /\b(tunai|cash)\b/i;

/** Cash math: "TUNAI 100.000" and "KEMBALI 19.900" mean the bill was 80.100. */
function cashMath(lines: string[]): { paid: number | null; change: number | null; paidInCash: boolean; exact: number[] } {
  const paidLines = lines.filter((l) => PAID.test(l) && !CHANGE.test(l) && !NOT_MONEY_LINE.test(l) && values(l).length > 0);
  const paid = paidLines.flatMap((l) => values(l).slice(-1));
  // A change row that OCR merged with the tax row ("Kembalian  DPP: 3.693 PPN: 406") has no change in it.
  const change = lines.filter((l) => CHANGE.test(l) && !TAX_OR_DISCOUNT.test(l) && !/\bdpp\b/i.test(l)).flatMap((l) => values(l).slice(-1));
  return {
    paid: paid.length > 0 ? Math.max(...paid) : null,
    change: change[0] ?? null,
    paidInCash: paidLines.some((l) => CASH.test(l)),
    // Card, QRIS and e-wallets pay the exact bill, so their amount is a witness for the total.
    exact: paidLines.filter((l) => !CASH.test(l)).flatMap((l) => values(l).slice(-1)),
  };
}

/** Clean one OCR line: collapse spaces, then mend look-alike characters in words and in numbers. */
export function cleanLine(line: string): string {
  return repairNumbers(repairWords(line.replace(/\s+/g, " ").trim()));
}

export function findTotal(rawLines: string[]): number | null {
  const lines = rawLines.map(cleanLine);
  const labelled = labelledTotal(lines);
  const { paid, change, paidInCash, exact } = cashMath(lines);
  const fromCash = paid !== null && change !== null && paid > change ? paid - change : null;
  const net = grossMinusDiscount(lines);
  const items = findItems(lines);
  // The items only count as a total when there are a couple of them (one line can be anything).
  const itemSum = items.length >= 2 ? round2(items.reduce((sum, i) => sum + i.amount, 0)) : null;
  // What the items add up to after the discounts (the discount rows are not items).
  const itemNet = itemSum !== null ? round2(itemSum - discountOf(lines)) : null;

  let total = labelled?.value ?? null;
  // "Total Belanja" one digit off from Total Item − Total Disc: one of the two lines was misread, and
  // the rest of the receipt decides which. Tesseract's "Belanja 18,200" with Total Item 81,200 and
  // Disc 3,000: the change (21,800 read as "2,800") fits 78,200, so the total was misread. PaddleOCR's
  // "Total Item 85.200" (for 85.300) with Belanja 80.100: the items add up to 80.100 and QRIS reads
  // "30.100", so the total was right and Total Item was misread. A tie keeps the printed total.
  // Never for a final "Total Tagihan" (rank 0): fees and shipping come after the discounts there.
  if (total !== null && net !== null && labelled!.rank > 0 && total !== net && support(total, lines) <= 1 && oneDigitApart(total, net)) {
    const witnesses = (v: number) =>
      (itemNet === v ? 2 : itemNet !== null && nearlyEqual(itemNet, v) ? 1 : 0) +
      exact.filter((p) => p === v || nearlyEqual(p, v)).length +
      (paid !== null && change !== null && paid > v && nearlyEqual(paid - v, change) ? 1 : 0);
    if (witnesses(net) > witnesses(total)) total = net;
  }

  if (total !== null) {
    // Backed by something independent (the discount arithmetic, the items, an exact card/QRIS payment,
    // or printed twice): settled, even if a misread change makes the cash math disagree.
    const backed = total === net || total === itemSum || total === itemNet || exact.includes(total) || support(total, lines) >= 2;
    if (backed || fromCash === null || fromCash === total) return total;
    // Cross-check: when the receipt shows paid and change, the total must add up with them. If it
    // doesn't, one number was misread ("TOTAL 10.100" for 80.100). The items decide when they add up
    // to the cash math's answer; otherwise keep the total only if the rest of the receipt backs it up
    // more than the cash math's answer. The total's own line doesn't count as backing, hence the - 1.
    if (itemSum === fromCash) return itemSum;
    return support(total, lines) - 1 > support(fromCash, lines) ? total : fromCash;
  }

  // No total label survived (faded, or cut off the photo): the discount arithmetic, when a payment
  // or the cash math agrees with it or nothing contradicts it; then what was paid minus the change.
  if (net !== null && (fromCash === null || fromCash === net || exact.includes(net))) return net;
  if (fromCash !== null) return fromCash;
  // Paid exactly by card/QRIS, printed again as the bill: that's the total.
  const exactTwice = exact.find((v) => support(v, lines) >= 2);
  if (exactTwice !== undefined) return exactTwice;
  // Paid without change: by card/QRIS that is the bill, but cash handed over ("TUNAI 100.000") is
  // usually more than the bill, so the items win when they are there and fit within it. Without any
  // paid line the items are not summed: a fuel receipt's "Harga/L 10.000" is a unit price, not an item.
  if (itemSum !== null && paid !== null && itemSum <= paid) return itemSum;
  if (paid !== null && change === null && !paidInCash) return paid;

  // Last resort: the largest real-looking amount that isn't on a phone, reference, tax, discount,
  // change or cash-handed-over line ("PPN 10.100" and "TUNAI 100.000" are never the bill).
  const all = lines
    .filter((l) => !NOT_MONEY_LINE.test(l) && !TAX_OR_DISCOUNT.test(l) && !NOT_TOTAL.test(l) && !CASH.test(l))
    .flatMap(values)
    .filter((n) => n >= 100 && n < 1e9);
  if (all.length > 0) return Math.max(...all);
  return paid;
}

// Item lines end where the totals start; these lines are never items. "BRS=1, QTY=1,00" is a
// koperasi/POS summary row (rows and pieces counted). Only a row with an amount ends the list:
// a header like "Pel.: UMUM/CASH" (customer: general, cash) mentions cash before any item.
const ITEMS_END = /\b(?:(sub\s*-?\s*total|total|harga\s*jual|jumlah|grand|tunai|cash|bayar|kembali|change|qris|debit|kredit|amount\s*due|balance)\b|brs\s*=|qty\s*=)/i;
const NOT_ITEM = /\b(periode|period|bulan|jl\.?|jln|jalan|telp|npwp|kasir|cashier|member|tgl|tanggal|date|struk|no\.?\s|nomor|invoice|faktur|kode|ref|terima\s*kasih|thank)\b/i;

/**
 * What was bought: each line before the totals that has a name and an amount at its end, e.g.
 * "INDOMIE GORENG 3 3.100 9.300" → Indomie Goreng, 9.300 (the line amount, the last number).
 * "Es Kopi Susu 2 x 18.000" with "36.000" on the next line takes the 36.000. Quantities, unit prices
 * and "x"/"@" are dropped from the name. Discounts, taxes and header lines are skipped.
 */
export function findItems(rawLines: string[]): ReceiptItem[] {
  const lines = rawLines.map(cleanLine);
  // A totals label on its own line ("TOTAL" with the amount below it) ends the list too.
  const end = lines.findIndex((l, i) => ITEMS_END.test(l) && (amountsIn(l).length > 0 || AMOUNT_ONLY.test(lines[i + 1] ?? "")));
  const body = end === -1 ? lines : lines.slice(0, end);
  const items: ReceiptItem[] = [];
  for (let i = 0; i < body.length; i++) {
    const line = body[i]!;
    // A minus amount is a discount even when OCR mangled its label ("liisc. -3,000" for "Disc. -3,000").
    if (NOT_ITEM.test(line) || TAX_OR_DISCOUNT.test(line) || DATE_LIKE.test(line) || NEGATIVE.test(line)) continue;
    const amounts = amountsIn(line);
    let amount = amounts.at(-1)?.value;
    const nameEnd = amounts[0]?.at ?? line.length;
    // Price on the next line on its own ("2 x 18.000" / "36.000"), or the name on one line and the
    // quantity row under it ("8992907720018 - SARI ROTI" / "1,00 PCS x 19.000,00= 19.000,00").
    const next = body[i + 1];
    if (next !== undefined && AMOUNT_ONLY.test(next) && (amount === undefined || /\d\s*[x@]\s*$|\bx\s*\d/i.test(line))) {
      amount = values(next)[0];
      i++;
    } else if (next !== undefined && amount === undefined && QTY_ROW.test(next) && amountsIn(next).length > 0) {
      amount = amountsIn(next).at(-1)!.value;
      i++;
    }
    if (amount === undefined || amount < 100) continue;
    const name = itemName(line.slice(0, nameEnd));
    if (name) items.push({ name, amount });
  }
  return items;
}

const DATE_LIKE = /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b|\b\d{1,2}:\d{2}\b/;

// A quantity row under an item's name: a count, maybe a unit, then "x" or "@" and the price.
const UNITS = "pcs|pc|bh|buah|unit|btl|bks|pak|pack|box|kg|gr|g|ltr|l|lbr|set|porsi|cup";
const QTY_ROW = new RegExp(`^\\s*\\d+(?:[.,]\\d+)?\\s*(?:${UNITS})?\\s*[x@]`, "i");
const ONLY_UNIT = new RegExp(`^(?:${UNITS}|x)(?:\\s+(?:${UNITS}|x))*$`, "i");

function itemName(raw: string): string | null {
  const name = raw
    .replace(/^\s*\d{8,14}\s*[-–:]?\s*/, "") // a barcode in front: "8992907720018 - SARI ROTI"
    .replace(/\s+\S*\d[.,]\d{3}\S*\s*$/, "") // a price OCR glued to a letter ("C7.000" for 67.000)
    .replace(/\s+(\d+\s*(x|@|pcs|pc|buah|bh)?\s*)+$/i, "") // trailing quantity: "3", "2 x", "1 pcs"
    .replace(/(\p{Lu}{3,})\d{1,2}\s*$/u, "$1") // a quantity OCR glued on: "INDOMIE GORENG3"
    .replace(/\s*[x@:]\s*$/i, "")
    .replace(/[^\p{L}\d&'./%+\- ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  // A quantity row on its own ("1,00 PCS x") has a unit but no name.
  if ((name.match(/\p{L}/gu) ?? []).length < 2 || ONLY_UNIT.test(name.replace(/[\d.,]+/g, " ").trim())) return null;
  return name === name.toUpperCase() ? titleCase(name).slice(0, 60) : name.slice(0, 60);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, peb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7,
  agu: 8, agt: 8, ags: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, nop: 11, des: 12, dec: 12,
};

function validDate(y: number, m: number, d: number, today: string): string | null {
  const year = y < 100 ? 2000 + y : y;
  const iso = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  // A receipt from the future, or from more than two years ago, is an OCR misread.
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (parsed.getTime() > todayMs + 86_400_000 || parsed.getTime() < todayMs - 2 * 366 * 86_400_000) return null;
  return iso;
}

// The till's software version printed next to the date ("V.2026.7.2", "Ver 2026.10.1") looks like a date.
const VERSION_BEFORE = /\b(v|ver|versi|version)\s*\.?\s*$/i;

function dateIn(line: string, today: string): string | null {
  const found: { at: number; date: string }[] = [];
  const add = (at: number, date: string | null) => {
    if (date && !VERSION_BEFORE.test(line.slice(0, at))) found.push({ at, date });
  };
  // 2026-10-20
  for (const m of line.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) add(m.index, validDate(Number(m[1]), Number(m[2]), Number(m[3]), today));
  // 20/10/2026, 20.10.26, 20-10-2026 (day first, the Indonesian order)
  for (const m of line.matchAll(/(?<![\d.])(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?![\d])/g)) {
    add(m.index, validDate(Number(m[3]), Number(m[2]), Number(m[1]), today));
  }
  // 20 Okt 2026, 20-OCT-26, 20 Oktober 2026
  for (const m of line.matchAll(/\b(\d{1,2})[\s-]+([a-z]{3})[a-z]*\.?[\s-]+(\d{4}|\d{2})\b/gi)) {
    const month = MONTHS[m[2]!.toLowerCase()];
    add(m.index, month ? validDate(Number(m[3]), month, Number(m[1]), today) : null);
  }
  // Oct 20, 2026 · October 20 2026 (English invoices)
  for (const m of line.matchAll(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi)) {
    const month = MONTHS[m[1]!.toLowerCase()];
    add(m.index, month ? validDate(Number(m[3]), month, Number(m[2]), today) : null);
  }
  // The first date on the line: "25-10-2026 09:56:05 V.2026.7.2".
  return found.sort((a, b) => a.at - b.at)[0]?.date ?? null;
}

export function findDate(lines: string[], today: string): string | null {
  // "Tanggal: 20/10/2026  Jatuh tempo: 03/11/2026" → only the part before the due date counts.
  const usable = lines.map((line) => {
    const due = line.search(DUE_LINE);
    return due === -1 ? line : line.slice(0, due);
  });
  // Labelled dates first ("Invoice date", "Tanggal transaksi"), then any date on the page.
  for (const line of usable) {
    const date = DATE_LABEL.test(line) ? dateIn(line, today) : null;
    if (date) return date;
  }
  for (const line of usable) {
    if (NOT_MONEY_LINE.test(line)) continue;
    const date = dateIn(line, today);
    if (date) return date;
  }
  return null;
}

const NOT_MERCHANT = /^(total\b|sub\s*total|grand\b|tunai\b|cash\b|kembali|bayar\b|jumlah\b|jl\b|jln\b|jalan\b|telp|tel\b|hp\b|npwp|no\b|kasir|cashier|tgl|tanggal|date|struk|receipt|invoice|faktur|tagihan|kwitansi|kuitansi|bill\b|nota|www\.|http|pt\.?\s|cv\.?\s|cabang|branch|ruko|komplek|gedung|kel\.|kec\.|kota\b|email|e-mail)/i;
// Where an invoice names who it is billed to: names after this belong to the buyer, not the seller.
const BUYER = /^(bill(ed)?\s*to|ship(ped)?\s*to|kepada|ditagihkan\s*kepada|tagihan\s*untuk|pembeli|customer|pelanggan|nama|sold\s*to|invoice\s*to|dikirim\s*ke|penerima)\b/i;
// A seller named outright: "Penjual: Toko Maju", "Sold by: Acme", "From: …".
const SELLER = /^(penjual|nama\s*toko|toko|merchant|sold\s*by|seller|from|dari|vendor|diterbitkan\s*(oleh|atas\s*nama))\s*[:\-]\s*(.*)$/i;
const LEGAL_FORM = /^(pt|cv|ud|pd)\.?\s+|[\s,]+(tbk|ltd|inc|llc|persero)\.?$/gi;

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s&/-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());

const clean = (raw: string) => raw.replace(/[^\p{L}\p{N}&'.\s-]/gu, " ").replace(/\s+/g, " ").trim();

function nameLike(line: string): boolean {
  const letters = (line.match(/\p{L}/gu) ?? []).length;
  return letters >= 3 && letters / line.replace(/\s/g, "").length >= 0.6 && !/\d{3,}/.test(line);
}

// "ALFAMART CIKINI 2" → branch numbers are not part of the name.
const asName = (line: string) => titleCase(line.replace(/\s+\d{1,2}$/, "")).slice(0, 60);

// Chains whose name is a safe bet wherever it shows near the top ("ALFAMART JATI MEKAR 2 / 0812…").
// Whole words only: "ALFA TOWER" in Alfamart's head-office address is not the shop.
const CHAINS = /\b(alfamart|alfamidi|alfaexpress|indomaret|indomaret\s*point|lawson|family\s*mart|circle\s*k|superindo|hypermart|transmart|giant|hero|lotte\s*mart|yogya|griya|ramayana|matahari|guardian|watsons|century|kimia\s*farma|k-?24|starbucks|kfc|mcdonald'?s|burger\s*king|pizza\s*hut|domino'?s|hokben|solaria|richeese|wingstop|j\.?co|breadtalk|chatime|mixue|janji\s*jiwa|kopi\s*kenangan|fore\s*coffee|point\s*coffee|pertamina|shell|vivo|bp\s*akr|ace\s*hardware|informa|ikea|uniqlo|miniso|gramedia|erafone)\b/i;

/** A chain's line as a name: "ALFAMART JATI MEKAR 2 / 081294665099" → "Alfamart Jati Mekar". */
function chainName(line: string): string {
  const name = line
    .replace(/\s*[/|]\s*.*$/, "") // " / phone", " | branch code"
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ") // "[JMK2]"
    .replace(/\b\d{6,}\b/g, " ")
    .replace(/[^\p{L}\p{N}&'.\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return asName(name);
}

/**
 * The shop or seller name: one labelled as the seller, else a known chain near the top, else the first
 * line near the top that reads like a name (not an address, a number, a store code or the buyer), else
 * the company's legal name ("PT Telkom").
 */
export function findMerchant(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const m = SELLER.exec(lines[i]!);
    if (!m) continue;
    const value = clean(m[3] || lines[i + 1] || "").replace(LEGAL_FORM, "").trim();
    if (nameLike(value)) return asName(value);
  }

  // A chain word on an item row ("SHELL HELIX 1 95.000") is a product, not the shop: no prices allowed.
  const chain = lines.slice(0, 12).find((l) => CHAINS.test(l) && !/^(pt|cv)\.?\s/i.test(l.trim()) && amountsIn(l).length === 0);
  if (chain) return chainName(chain);

  const top: string[] = [];
  for (const raw of lines.slice(0, 8)) {
    // "[JMK2]" or "JATI MEKAR 2 [JMK2]": a store code in brackets is not part of a name.
    const line = clean(raw.replace(/\[[^\]]*\]/g, " "));
    if (BUYER.test(line)) break;
    top.push(line);
  }
  const plain = top.find((line) => nameLike(line) && !NOT_MERCHANT.test(line));
  if (plain) return asName(plain);
  const legal = top.find((line) => /^(pt|cv|ud|pd)\.?\s/i.test(line) && nameLike(line));
  return legal ? asName(legal.replace(LEGAL_FORM, "").trim()) : null;
}

const INVOICE = /\b(invoice|faktur|tagihan|kwitansi|kuitansi|amount\s*due|balance\s*due|jatuh\s*tempo|due\s*date)\b/i;

const PAYMENTS: [RegExp, string][] = [
  [/\b(qris|cpm)\b/i, "QRIS"],
  [/\bgo\s*pay\b/i, "GoPay"],
  [/\bovo\b/i, "OVO"],
  [/\bdana\b/i, "DANA"],
  [/\bshopee\s*pay\b/i, "ShopeePay"],
  [/\blink\s*aja\b/i, "LinkAja"],
  [/\bbca\b/i, "BCA"],
  [/\bmandiri\b/i, "Mandiri"],
  [/\bbri\b/i, "BRI"],
  [/\bbni\b/i, "BNI"],
  [/\b(debit|kartu\s*debit|edc)\b/i, "Debit"],
  [/\b(kredit|credit\s*card|visa|mastercard)\b/i, "Credit card"],
  [/\b(tunai|cash)\b/i, "Cash"],
];

export function findPayment(lines: string[]): string | null {
  const text = lines.join("\n");
  for (const [re, name] of PAYMENTS) if (re.test(text)) return name;
  return null;
}

export function parseReceipt(text: string, today: string): ReceiptInfo {
  // Every finder reads the same cleaned lines: spaces collapsed, misread letters and digits mended.
  const lines = text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((l) => l !== "");
  return {
    kind: INVOICE.test(text) ? "invoice" : "receipt",
    total: findTotal(lines),
    date: findDate(lines, today),
    merchant: findMerchant(lines),
    payment: findPayment(lines),
    items: findItems(lines),
  };
}
