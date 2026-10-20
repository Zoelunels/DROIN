import { pool } from "../db";
import { addDays, todayIn } from "../time";
import type { TransactionType } from "../validate";

// Turns a short sentence into a transaction draft: "lunch 25k gopay", "gaji 8jt bca kemarin".
// Rule-based (no AI): amount, date, wallet, type and category are recognised separately and
// the leftover words become the note. Nothing is saved — the app shows the draft for review.

export interface QuickDraft {
  amount: number | null;
  type: TransactionType;
  category_id: number | null;
  category_name: string | null;
  wallet_id: number | null;
  wallet_name: string | null;
  transaction_date: string;
  note: string | null;
  // How each field was decided, so the app can highlight guesses.
  matched: {
    amount: boolean;
    type: "keyword" | "category" | "default";
    category: "history" | "name" | "keyword" | "none";
    wallet: "name" | "most_used" | "none";
    date: "text" | "default";
  };
}

const MULTIPLIERS: Record<string, number> = {
  k: 1e3, rb: 1e3, ribu: 1e3, rban: 1e3,
  jt: 1e6, juta: 1e6, m: 1e6, mio: 1e6,
};

// 25k · 25rb · 25 ribu · 1.5jt · 1,5 juta · Rp25.000 · 25000 · 25.000,50
const AMOUNT_RE = /(?:rp\.?\s*)?(\d+(?:[.,]\d+)*)\s*(k|rb|rban|ribu|jt|juta|mio|m)?(?![a-z])/gi;

export function parseAmount(text: string): { amount: number; match: string } | null {
  let best: { amount: number; match: string; strong: boolean } | null = null;
  for (const m of text.matchAll(AMOUNT_RE)) {
    const [match, digits, suffix] = m as unknown as [string, string, string | undefined];
    const hasRp = /^rp/i.test(match);
    let value: number;
    if (suffix) {
      value = Number(digits.replace(",", ".")) * MULTIPLIERS[suffix.toLowerCase()]!;
    } else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(digits)) {
      value = Number(digits.replace(/\./g, "").replace(",", ".")); // 25.000,50 (Indonesian)
    } else if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(digits)) {
      value = Number(digits.replace(/,/g, "")); // 25,000.50 (English)
    } else if (/^\d{1,3}([.,]\d{3})+$/.test(digits)) {
      value = Number(digits.replace(/[.,]/g, "")); // 25.000 or 25,000 → thousands separators
    } else if (/^\d+[.,]\d{1,2}$/.test(digits)) {
      value = Number(digits.replace(",", ".")); // 25,5 → decimal
    } else {
      value = Number(digits.replace(/[.,]/g, ""));
    }
    if (!Number.isFinite(value) || value <= 0) continue;
    const strong = Boolean(suffix) || hasRp;
    // Prefer amounts written with a unit or "Rp"; otherwise the largest number (not "2" in "2 coffees").
    if (!best || (strong && !best.strong) || (strong === best.strong && value > best.amount)) {
      best = { amount: Math.round(value * 100) / 100, match: match.trim(), strong };
    }
  }
  return best && { amount: best.amount, match: best.match };
}

export function parseDate(text: string, today: string): { date: string; match: string } | null {
  const lower = text.toLowerCase();
  const simple: [RegExp, number][] = [
    [/\b(today|hari ini|hr ini)\b/, 0],
    [/\b(yesterday|kemarin|kmrn|kmarin)\b/, -1],
    [/\b(kemarin lusa|day before yesterday)\b/, -2],
  ];
  // Longest phrases first so "kemarin lusa" wins over "kemarin".
  for (const [re, offset] of [simple[2]!, simple[0]!, simple[1]!]) {
    const m = lower.match(re);
    if (m) return { date: addDays(today, offset), match: m[0] };
  }
  const ago = lower.match(/\b(\d{1,2})\s*(days? ago|hari (?:yang )?lalu)\b/);
  if (ago) return { date: addDays(today, -Number(ago[1])), match: ago[0] };

  // 5/10 or 5/10/2026 (day/month, the Indonesian order)
  const dm = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (dm) {
    const year = dm[3] ?? today.slice(0, 4);
    const date = `${year}-${dm[2]!.padStart(2, "0")}-${dm[1]!.padStart(2, "0")}`;
    const d = new Date(`${date}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date) return { date, match: dm[0] };
  }
  return null;
}

const INCOME_WORDS = /\b(salary|gaji|gajian|bonus|thr|income|received|receive|terima|dapat|dapet|refund|cashback|jual|sold|komisi|commission|dividen|dividend|transferan masuk)\b/i;

// Words → default category names (English defaults created at sign-up). Users who renamed a
// category are covered by the history and name matching first.
const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/\b(makan|lunch|dinner|breakfast|sarapan|makan siang|makan malam|kopi|coffee|ngopi|snack|jajan|bakso|nasi|mie|ayam|resto|restaurant|cafe|kafe|boba|teh|minum|drink|gofood|grabfood|shopeefood)\b/i, "Food & Drinks"],
  [/\b(groceries|grocery|belanja bulanan|sayur|indomaret|alfamart|supermarket|pasar|beras|minyak|telur)\b/i, "Groceries"],
  [/\b(grab|gojek|gocar|goride|ojek|ojol|taxi|taksi|bensin|fuel|pertalite|pertamax|parkir|parking|tol|toll|krl|mrt|lrt|transjakarta|busway|kereta|train|bus|angkot)\b/i, "Transport"],
  [/\b(shopee|tokopedia|lazada|baju|clothes|shoes|sepatu|shopping|belanja)\b/i, "Shopping"],
  [/\b(listrik|electricity|pln|token|air|water|pdam|internet|wifi|indihome|pulsa|kuota|data|phone bill|tagihan|bill)\b/i, "Bills & Utilities"],
  [/\b(kos|kost|sewa|rent|kontrakan|cicilan rumah|kpr)\b/i, "Housing"],
  [/\b(dokter|doctor|obat|medicine|apotek|pharmacy|rumah sakit|hospital|klinik|clinic|bpjs|vitamin)\b/i, "Health"],
  [/\b(netflix|spotify|youtube|disney|bioskop|cinema|movie|film|game|steam|konser|concert|nonton)\b/i, "Entertainment"],
  [/\b(kursus|course|buku|book|sekolah|school|kuliah|tuition|spp|ukt|les)\b/i, "Education"],
  [/\b(kado|gift|hadiah|donasi|donation|zakat|sedekah|infaq|kondangan|amplop)\b/i, "Gifts & Donations"],
  [/\b(admin|biaya admin|fee)\b/i, "Admin Fees"],
  [/\b(salary|gaji|gajian)\b/i, "Salary"],
  [/\b(bonus|thr)\b/i, "Bonus"],
];

const STOP_WORDS = new Set(["di", "ke", "dari", "pakai", "pake", "via", "with", "using", "at", "for", "buat", "untuk", "the", "a", "and", "dan", "rp", "rupiah"]);

// Speech-to-text often writes Indonesian amounts as words ("dua puluh lima ribu") or slang
// ("goceng"). Each such run is rewritten as "Rp25000" so parseAmount sees a strong amount.
// Bare numbers without ratus/ribu/juta ("dua kopi") are left alone.
const DIGIT_WORDS: Record<string, number> = {
  nol: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9,
};
const SE_WORDS: Record<string, number> = { sepuluh: 10, sebelas: 11, seratus: 100 };
const SCALE_WORDS: Record<string, number> = { ribu: 1e3, rb: 1e3, juta: 1e6, jt: 1e6 };
const SE_SCALE_WORDS: Record<string, number> = { seribu: 1e3, sejuta: 1e6 };
const SLANG_AMOUNTS: Record<string, number> = { seceng: 1e3, noceng: 2e3, goceng: 5e3, ceban: 1e4, gocap: 5e4 };
const NUMBER_WORD = new Set([
  ...Object.keys(DIGIT_WORDS), ...Object.keys(SE_WORDS), ...Object.keys(SCALE_WORDS),
  ...Object.keys(SE_SCALE_WORDS), ...Object.keys(SLANG_AMOUNTS), "belas", "puluh", "ratus", "setengah", "koma",
]);

function wordsToNumber(words: string[]): number | null {
  let total = 0; // finished groups (… juta, … ribu)
  let group = 0; // the current group below a thousand
  let unit = 0; // the last digit word, waiting for belas/puluh/ratus
  let fraction = 0; // "koma lima" / "setengah"
  let decimal = false;
  let money = false; // only runs with ratus/ribu/juta/slang are amounts
  for (const w of words) {
    if (w in DIGIT_WORDS) {
      if (decimal) {
        fraction = DIGIT_WORDS[w]! / 10;
        decimal = false;
      } else unit = DIGIT_WORDS[w]!;
    } else if (w in SE_WORDS) {
      group += SE_WORDS[w]!;
      if (w === "seratus") money = true;
    } else if (w === "belas") {
      group += 10 + unit;
      unit = 0;
    } else if (w === "puluh") {
      group += unit * 10;
      unit = 0;
    } else if (w === "ratus") {
      group += unit * 100;
      unit = 0;
      money = true;
    } else if (w === "koma") {
      decimal = true;
    } else if (w === "setengah") {
      fraction = 0.5;
    } else if (w in SE_SCALE_WORDS) {
      total += SE_SCALE_WORDS[w]!;
      money = true;
    } else if (w in SCALE_WORDS) {
      total += (group + unit + fraction) * SCALE_WORDS[w]!; // "setengah juta" = 0.5 × 1e6
      group = unit = fraction = 0;
      money = true;
    } else if (w in SLANG_AMOUNTS) {
      total += (group + unit || 1) * SLANG_AMOUNTS[w]!;
      group = unit = 0;
      money = true;
    }
  }
  total += group + unit;
  return money && total > 0 ? Math.round(total) : null;
}

export function normalizeSpokenAmounts(text: string): string {
  // Runs of number words separated by spaces, e.g. "satu juta dua ratus ribu".
  return text.replace(/\p{L}+(?:\s+\p{L}+)*/gu, (phrase) => {
    const words = phrase.split(/\s+/);
    const out: string[] = [];
    let run: string[] = [];
    const flush = () => {
      if (run.length === 0) return;
      // "rb"/"jt" alone are suffixes of a digit amount ("25 rb"), not a spoken number.
      const value = run.every((w) => w.toLowerCase() in SCALE_WORDS) ? null : wordsToNumber(run.map((w) => w.toLowerCase()));
      out.push(value === null ? run.join(" ") : `Rp${value}`);
      run = [];
    };
    for (const w of words) {
      if (NUMBER_WORD.has(w.toLowerCase())) run.push(w);
      else {
        flush();
        out.push(w);
      }
    }
    flush();
    return out.join(" ");
  });
}

// "kopi 25 ribu, parkir goceng" → ["kopi 25 ribu", "parkir goceng"]. Only splits when every piece
// has its own amount, so "makan, minum 30k" stays one draft. "1,5jt" has no space and is not split.
export function splitItems(text: string, max = 5): string[] {
  const pieces = normalizeSpokenAmounts(text)
    .split(/\s*(?:,\s+|;|\n)\s*|\s+(?:terus|trus|lalu|habis itu|then)\s+/i)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (pieces.length < 2 || pieces.length > max || pieces.some((p) => !parseAmount(p))) return [text.trim()];
  return pieces;
}

export async function parseQuickInput(userId: number, timezone: string, text: string): Promise<QuickDraft> {
  const today = todayIn(timezone);
  text = normalizeSpokenAmounts(text);
  let rest = ` ${text} `;
  const remove = (fragment: string) => {
    rest = rest.replace(fragment, " ");
  };

  const amount = parseAmount(text);
  if (amount) remove(amount.match);
  const date = parseDate(rest, today);
  if (date) rest = rest.replace(new RegExp(date.match.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "i"), " ");

  // Wallet: the longest wallet name that appears in the text.
  const wallets = await pool.query(
    "SELECT id, name FROM wallets WHERE user_id = $1 AND archived_at IS NULL ORDER BY length(name) DESC",
    [userId],
  );
  let wallet: { id: number; name: string } | null = null;
  let walletHow: QuickDraft["matched"]["wallet"] = "none";
  for (const w of wallets.rows) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${w.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "iu");
    if (re.test(rest)) {
      wallet = w;
      walletHow = "name";
      rest = rest.replace(re, "$1 ");
      break;
    }
  }
  if (!wallet) {
    // Fall back to the wallet used most in the last 30 days.
    const used = await pool.query(
      `SELECT w.id, w.name FROM transactions t JOIN wallets w ON w.id = t.wallet_id
       WHERE t.user_id = $1 AND t.origin = 'manual' AND w.archived_at IS NULL AND t.transaction_date >= $2
       GROUP BY w.id ORDER BY count(*) DESC LIMIT 1`,
      [userId, addDays(today, -30)],
    );
    wallet = used.rows[0] ?? wallets.rows[0] ?? null;
    walletHow = wallet ? "most_used" : "none";
  }

  const note = rest
    .split(/\s+/)
    .map((w) => w.replace(/^[.,!?;:]+|[.,!?;:]+$/g, "")) // speech-to-text adds sentence punctuation
    .filter((w) => w !== "" && !STOP_WORDS.has(w.toLowerCase()))
    .join(" ")
    .trim();
  const words = note.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);

  // Category: 1) what the user picked before for a note with the same words,
  //           2) a category whose name appears in the text, 3) the keyword list.
  const categories = await pool.query(
    "SELECT id, name, type FROM categories WHERE user_id = $1 AND archived_at IS NULL",
    [userId],
  );
  let category: { id: number; name: string; type: TransactionType } | null = null;
  let categoryHow: QuickDraft["matched"]["category"] = "none";
  if (words.length > 0) {
    const history = await pool.query(
      `SELECT c.id, c.name, c.type FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = $1 AND t.origin = 'manual' AND c.archived_at IS NULL
         AND t.note ILIKE ANY($2::text[])
       GROUP BY c.id ORDER BY count(*) DESC, max(t.id) DESC LIMIT 1`,
      [userId, words.map((w) => `%${w.replace(/[\\%_]/g, "\\$&")}%`)],
    );
    if (history.rows[0]) {
      category = history.rows[0];
      categoryHow = "history";
    }
  }
  if (!category) {
    const lowerText = text.toLowerCase();
    const byName = categories.rows
      .filter((c) => lowerText.includes(c.name.toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (byName) {
      category = byName;
      categoryHow = "name";
    }
  }
  if (!category) {
    for (const [re, name] of CATEGORY_KEYWORDS) {
      if (!re.test(text)) continue;
      const found = categories.rows.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (found) {
        category = found;
        categoryHow = "keyword";
        break;
      }
    }
  }

  let type: TransactionType = "expense";
  let typeHow: QuickDraft["matched"]["type"] = "default";
  if (category) {
    type = category.type;
    typeHow = "category";
  } else if (INCOME_WORDS.test(text)) {
    type = "income";
    typeHow = "keyword";
  }

  return {
    amount: amount?.amount ?? null,
    type,
    category_id: category?.id ?? null,
    category_name: category?.name ?? null,
    wallet_id: wallet?.id ?? null,
    wallet_name: wallet?.name ?? null,
    transaction_date: date?.date ?? today,
    note: note === "" ? null : note,
    matched: {
      amount: amount !== null,
      type: typeHow,
      category: categoryHow,
      wallet: walletHow,
      date: date ? "text" : "default",
    },
  };
}
