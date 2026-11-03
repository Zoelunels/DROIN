import { afterEach, describe, expect, test } from "bun:test";
import { HttpError } from "../src/errors";
import sharp from "sharp";
import { type OcrBox, prepareForOcr, rowsFromBoxes, setReceiptReader } from "../src/services/ocr";
import { findDate, findItems, findTotal, parseReceipt, repairNumbers } from "../src/services/receipt";
import { api, newUser } from "./helpers";

const TODAY = "2026-10-20";
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

// Real Tesseract output (ind+eng) from test images of an Indomaret-style and a café receipt,
// including its misreads ("lA2B/KASIRO1", "KEMBALI H").
const INDOMARET = `INDOMARET

PT. INDOMARCO PRISMATAMA

JL. KEMANG RAYA NO. 12

NPWP 01.337.994.6-092.000
20.10.2026-08:41 lA2B/KASIRO1

AQUA 600ML 2 4.000 8.000
ROTI TAWAR SARI 1 16.500 16.500
INDOMIE GORENG 5 3.100 15.500
HARGA JUAL : 40.000
TOTAL : 40.000
TUNAI : 50.000
KEMBALI H 10.000
TERIMA KASIH. SELAMAT BELANJA KEMBALI`;

const CAFE = `KOPI SENJA

Jl. Cikini Raya 45, Jakarta

Telp 021-555-0199

Tgl: 19/10/2026 Jam 15:20

Es Kopi Susu 2 x 18.000
36.000

Croissant 1 x 22.000
22.000

Subtotal 58.000

PB1 10% 5.800

GRAND TOTAL 63.800

Bayar QRIS 63.800

Terima kasih!`;

// A marketplace invoice: totals before and after discounts, the buyer's name, an order number full of digits.
const MARKETPLACE = `INVOICE
INV/20261015/MPL/3871234567
DITERBITKAN ATAS NAMA
Penjual : Toko Elektronik Jaya
UNTUK
Pembeli : Budi Santoso
Tanggal Pembelian : 15 Oktober 2026
Kabel USB-C 1m 2 35.000 70.000
Charger 20W 1 150.000 150.000
TOTAL HARGA (3 BARANG) Rp220.000
Total Ongkos Kirim Rp15.000
Diskon Ongkos Kirim -Rp15.000
Total Diskon Barang -Rp20.000
TOTAL BELANJA Rp200.000
Biaya Layanan Rp1.000
TOTAL TAGIHAN Rp201.000
Metode Pembayaran: BCA Virtual Account`;

// An English service invoice: a due date after the invoice date, and a "Bill To" company.
const SERVICE = `ACME DIGITAL STUDIO
Jl. Sudirman Kav. 21, Jakarta
INVOICE
Invoice No: INV-2026-0042
Due Date: Oct 19, 2026
Invoice Date: Oct 5, 2026
Bill To:
PT Maju Mundur
Website maintenance 1 2.500.000 2.500.000
Hosting (1 year) 1 1.200.000 1.200.000
Subtotal 3.700.000
PPN 11% 407.000
Total 4.107.000
Amount Paid 0
Balance Due Rp 4.107.000
Transfer to BCA 123-456-7890`;

// A utility bill: only the company's legal name, and the customer's name near the top.
const PLN = `PT PLN (PERSERO)
TAGIHAN LISTRIK
ID Pelanggan: 532110987654
Nama: BUDI SANTOSO
Periode: OKT 2026
Tanggal Bayar: 18/10/2026
Total Tagihan: Rp 356.420`;

// A one-page PDF with real text, each [text, x, y] placed where it would print.
function makePdf(items: [string, number, number][]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (ch) => `\\${ch}`);
  const content = items.map(([s, x, y]) => `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm (${esc(s)}) Tj ET`).join("\n");
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 600]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    `<</Length ${content.length}>>stream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj${body}endobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("receipt parser", () => {
  test("Indomaret: total, date, shop, cash", () => {
    expect(parseReceipt(INDOMARET, TODAY)).toEqual({
      kind: "receipt", total: 40_000, date: "2026-10-20", merchant: "Indomaret", payment: "Cash",
      items: [
        { name: "Aqua 600ml", amount: 8_000 },
        { name: "Roti Tawar Sari", amount: 16_500 },
        { name: "Indomie Goreng", amount: 15_500 },
      ],
    });
  });

  test("café: grand total wins over subtotal and tax, QRIS", () => {
    expect(parseReceipt(CAFE, TODAY)).toEqual({
      kind: "receipt", total: 63_800, date: "2026-10-19", merchant: "Kopi Senja", payment: "QRIS",
      // The price is on the line after "2 x 18.000": the line amount, not the unit price.
      items: [{ name: "Es Kopi Susu", amount: 36_000 }, { name: "Croissant", amount: 22_000 }],
    });
  });

  test("total on the line after its label, and Rp / decimals formats", () => {
    expect(findTotal(lines("SUBTOTAL\n120.000\nTOTAL BAYAR\nRp 132.000"))).toBe(132_000);
    expect(findTotal(lines("Total Rp1.250.000,00"))).toBe(1_250_000);
    expect(findTotal(lines("TOTAL 25,000.50"))).toBe(25_000.5);
    expect(findTotal(lines("Jumlah 45000"))).toBe(45_000);
  });

  test("ignores item counts, discounts and change", () => {
    expect(findTotal(lines("TOTAL ITEM 12\nTOTAL DISKON 5.000\nTOTAL 88.500\nKEMBALI 11.500"))).toBe(88_500);
  });

  test("no total line: paid minus change, else the largest real amount", () => {
    expect(findTotal(lines("Nasi Goreng 25.000\nTUNAI 50.000\nKEMBALIAN 25.000"))).toBe(25_000);
    expect(findTotal(lines("Telp 0812-3456-7890\nNPWP 01.234.567.8-901.000\nPertalite 30.000\nHarga/L 10.000"))).toBe(30_000);
  });

  test("dates in Indonesian and English styles; future and ancient dates are misreads", () => {
    expect(findDate(lines("Tanggal 20 Okt 2026"), TODAY)).toBe("2026-10-20");
    expect(findDate(lines("Date: 18-OCT-26 14:02"), TODAY)).toBe("2026-10-18");
    expect(findDate(lines("2026-10-01 10:00"), TODAY)).toBe("2026-10-01");
    expect(findDate(lines("05/10/26"), TODAY)).toBe("2026-10-05");
    expect(findDate(lines("31/12/2026"), TODAY)).toBeNull(); // future
    expect(findDate(lines("01/01/2019"), TODAY)).toBeNull(); // years ago
    expect(findDate(lines("32/13/2026"), TODAY)).toBeNull(); // not a date
    expect(findDate(lines("AQUA 600ML 2 4.000 8.000"), TODAY)).toBeNull(); // prices are not dates
  });

  test("shop name skips addresses, legal names and numbers", () => {
    expect(parseReceipt("PT SUMBER ALFARIA TRIJAYA\nALFAMART CIKINI 2\nJl. Cikini 1\nTOTAL 10.000", TODAY).merchant).toBe("Alfamart Cikini");
    expect(parseReceipt("**** 0812 3456 ****\nSate Pak Kumis\nTOTAL 40.000", TODAY).merchant).toBe("Sate Pak Kumis");
    // A bare 7-digit run is a code or reference, not money: no total rather than Rp 1.234.567.
    expect(parseReceipt("1234567\n%%%\n", TODAY)).toEqual({ kind: "receipt", total: null, date: null, merchant: null, payment: null, items: [] });
  });

  // Faded thermal receipts: OCR text where the real total is 80.100 but a careless reading picks
  // something else, a smaller amount on the same line or a huge reference/date/barcode number.
  describe("total survives OCR mistakes", () => {
    test("the amount right after TOTAL, not the last one on the line", () => {
      expect(findTotal(lines("TOTAL 80.100 DISKON 10.100"))).toBe(80_100);
      expect(findTotal(lines("TOTAL 80.100   PPN 8.010"))).toBe(80_100);
    });

    test("'Total Item' on the same line doesn't hide the real total", () => {
      expect(findTotal(lines("Total Item 6  Total Belanja 80.100"))).toBe(80_100);
    });

    test("look-alike letters inside a number are read as digits", () => {
      expect(findTotal(lines("TOTAL B0.100"))).toBe(80_100);
      expect(findTotal(lines("TOTAL 8O.1OO"))).toBe(80_100);
      expect(findTotal(lines("TOTAL Rp8O.l00"))).toBe(80_100);
      expect(findTotal(lines("TOTAL 80, 100"))).toBe(80_100);
    });

    test("a label on its own line takes the next line only if it is just an amount", () => {
      expect(findTotal(lines("GRAND TOTAL\n80.100"))).toBe(80_100);
      expect(findTotal(lines("TOTAL\nPPN 10.100"))).toBeNull();
    });

    test("paid minus change corrects a misread total (8 read as 1)", () => {
      expect(findTotal(lines("TOTAL 10.100\nTUNAI 100.000\nKEMBALI 19.900"))).toBe(80_100);
    });

    test("…but a total the receipt prints twice beats a misread change", () => {
      expect(findTotal(lines("HARGA JUAL 80.100\nTOTAL 80.100\nTUNAI 100.000\nKEMBALI 18.900"))).toBe(80_100);
    });

    test("reference numbers, dates and barcodes are never the total", () => {
      expect(findTotal(lines("TOTAL 80.100\nNo Tagihan 230512345"))).toBe(80_100);
      expect(findTotal(lines("No. Tagihan : 230512345\nTotal Tagihan Rp 80.100"))).toBe(80_100);
      expect(findTotal(lines("20251026 0841\nHarga Jual 80.100"))).toBe(80_100);
      expect(findTotal(lines("AQUA 2 8.000\nROTI 1 72.100\n899876543"))).toBe(72_100);
      expect(findTotal(lines("MEMBER 0812345678\nHarga Jual 80.100"))).toBe(80_100);
    });

    test("cash handed over (TUNAI) is never taken as the total", () => {
      // TOTAL's amount lost by the OCR and no change line: the items add up to the bill.
      expect(findTotal(lines(`INDOMIE GORENG 3 3.100 9.300
AQUA 600ML 2 4.000 8.000
ROTI SARI ROTI 1 16.500 16.500
SUSU ULTRA 1L 2 21.150 42.300
TELUR 1/4 KG 1 4.000 4.000
TOTAL
TUNAI 100.000`))).toBe(80_100);
      // Only the cash line left: it is still not the bill, so the largest other amount is the guess.
      expect(findTotal(lines("Nasi Goreng 25.000\nTUNAI 50.000"))).toBe(25_000);
      // Card and QRIS pay the exact bill, so there the paid amount is the total.
      expect(findTotal(lines("Bayar QRIS 63.800"))).toBe(63_800);
    });

    test("misread labels still count: T0TAL, TUNAl, KEMBAL1", () => {
      expect(findTotal(lines("T0TAL 80.100\nTUNAl 100.000\nKEMBAL1 19.900"))).toBe(80_100);
      expect(findTotal(lines("T0TAL 10.100\nTUNAl 100.000\nKEMBAL1 19.900"))).toBe(80_100);
      expect(parseReceipt("TOTAI 80.100\nTUNAl 100.000", TODAY).payment).toBe("Cash");
    });

    test("the items settle a disagreement between TOTAL and the cash math", () => {
      // KEMBALI misread (18.900 instead of 19.900): the items add up to the printed total.
      expect(findTotal(lines("Teh 30.100\nRoti 50.000\nTOTAL 80.100\nTUNAI 100.000\nKEMBALI 18.900"))).toBe(80_100);
    });

    test("nothing that looks like money gives no total, not a made-up one", () => {
      expect(findTotal(lines("20251026\n230512345\n0812345678"))).toBeNull();
    });
  });

  describe("items", () => {
    test("name and line amount; quantity and unit price dropped", () => {
      expect(findItems(lines("INDOMIE GORENG 3 3.100 9.300\nTELUR 1/4 KG 1 4.000 4.000\nTOTAL 13.300"))).toEqual([
        { name: "Indomie Goreng", amount: 9_300 },
        { name: "Telur 1/4 Kg", amount: 4_000 },
      ]);
    });

    test("look-alike letters in names and prices are mended", () => {
      expect(findItems(lines("IND0MIE GORENG 3 3.1OO 9.3OO\nTOTAL 9.300"))).toEqual([{ name: "Indomie Goreng", amount: 9_300 }]);
    });

    test("headers, dates, discounts, taxes and summary lines are not items", () => {
      expect(
        findItems(lines(`ALFAMART CIKINI
JL. CIKINI RAYA 45
26-10-2026 18:22 KASIR02
AQUA 600ML 2 4.000 8.000
DISC PROMO -1.000
PPN 11% 770
HARGA JUAL : 7.000
TOTAL 7.000`)),
      ).toEqual([{ name: "Aqua 600ml", amount: 8_000 }]);
    });

    test("a receipt that lists no items gives none", () => {
      expect(findItems(lines("TOTAL 80.100\nTUNAI 100.000"))).toEqual([]);
    });
  });

  describe("PaddleOCR output", () => {
    // Real PaddleOCR text (after rowsFromBoxes) of a blurred, faded Alfamart test photo: close columns
    // come back glued together ("24.0008.000" is "2  4.000  8.000") and a quantity sticks to the name.
    const PADDLE_ALFAMART = `ALFAMART CIKINI
JL. CIKINI RAYA 45
26-10-2026 18:22 KASIR02
INDOMIE GORENG3 3.100 9.300
AQUA 600ML 24.0008.000
ROTI SARI ROTI 1 16.500 16.500
SUSU ULTRA 1L 2 21.15042.300
TELUR 1/4 KG 14.0004.000
TOTAL ITEM 9
TOTAL   80.100
TUNAI   100.000
KEMBALI   19.900
TERIMA KASTH`;

    test("glued columns are split back into their numbers", () => {
      expect(repairNumbers("AQUA 600ML 24.0008.000")).toBe("AQUA 600ML 24.000 8.000");
      expect(repairNumbers("SUSU 2 21.15042.300")).toBe("SUSU 2 21.150 42.300");
      expect(repairNumbers("A 1.0002.0003.000")).toBe("A 1.000 2.000 3.000");
    });

    test("ordinary amounts are left alone", () => {
      for (const s of ["TOTAL 1.250.000", "TOTAL 63.800,00", "AQUA 2 4.000 8.000", "TOTAL 45000"]) expect(repairNumbers(s)).toBe(s);
    });

    test("the whole receipt: total, date, shop and every item", () => {
      expect(parseReceipt(PADDLE_ALFAMART, "2026-10-28")).toMatchObject({
        total: 80_100,
        date: "2026-10-26",
        merchant: "Alfamart Cikini",
        items: [
          { name: "Indomie Goreng", amount: 9_300 },
          { name: "Aqua 600ml", amount: 8_000 },
          { name: "Roti Sari Roti", amount: 16_500 },
          { name: "Susu Ultra 1l", amount: 42_300 },
          { name: "Telur 1/4 Kg", amount: 4_000 },
        ],
      });
    });
  });

  // Two real Alfamart receipts (photos from a user), as each OCR engine read them. Both print
  // Total Item (before discount) · Total Disc · Total Belanja (the bill), then the payment, and a
  // till version "V.2026.7.2" next to the date. The second photo cut off the left edge of every label.
  describe("real Alfamart receipts with discounts", () => {
    const PADDLE_CASH = `ALFAMART JATI MEKAR 2 / 081294665099
JATI MEKAR 2 [JMK2]
ALFA TOWER LT.12, ALAM SUTERA,TANGERANG
NPWP：01.336.238.9-054.000
Bon JA16-406-25109WV8 Kasir : EMA AM
MIZONE MOD500ML   1 7,100 7,100
HIZONE CCO500ML   1 7,100 7,100
liisc. -3,000
UJOY BPOD AP2ML   C7.000 67,000
Total Item 3   81,200
Total Disc.   3,000
Total Belanja   78,200
Tunai   100,000
Kembalian   21,800
PPN   DPP: 12,792 PPN: 1,407
[gl. 25-10-2026 09:56:05 V.2026.7.2`;

    // Tesseract on the same photo: "Total Belanja 78,200" became "lola] Belanja 18,200", the change
    // lost a digit, and Tunai/Kembalian are mangled. Before the fix this gave the cash, 100.000.
    const TESSERACT_CASH = `ALFAMART JATI MEKAR 2? / 08129466500
JATI MEKAR 2 LJMK2)
y  Bon JAI6-406-Z5109Wv8 Kasir { "
WMIZONEMODSOOM. | 7,10 7.1m
8 HIZONE CCOS00ML      1 7,100     (4100
ia    H18C,    -3, 000
x    UJOY BPOD APM     lel.) 61,000
lotal ten     3                  81,200
Total Disc.                       3,000
lola] Belanja                    18,200
lunai                                100,000
Kerbal ian                                         2,800
ON          DPP: 12,792 PPN: 1,401
gl. 25-10-2026 09:56:05 ¥.2026.7.2`;

    // The cut-off photo, paid by QRIS ("QRIS CPM ALFA" → "IS CPM ALFA"). Before the fix: 71.100,
    // the price before the 1.200 discount.
    const PADDLE_QRIS_CUT = `JATI MEKAR 2 [JMK2]
OWER LT.12. ALAM SUTERA.TANGERANG
n JA16-241-2809H7Z3 Kasir : LISTI
OY BPOD AP2ML   1 67.000 67.000
CUK 350ML   1 4.100 4.100
SC. -1.200
tal Item 2   71.100
tal Disc.   1,200
tal Belania   69.900
IS CPM ALFA   69.900
0
mbalian   DPP: 3.693 PPN: 406
28-09-2026 08:55:42 V 2026.7.2`;

    test("the bill after the discount, not the cash handed over or the price before it", () => {
      expect(parseReceipt(PADDLE_CASH, "2026-10-30")).toEqual({
        kind: "receipt", total: 78_200, date: "2026-10-25", merchant: "Alfamart Jati Mekar", payment: "Cash",
        // The discount row is not an item, and "500ML" stays 500ml.
        items: [
          { name: "Mizone Mod500ml", amount: 7_100 },
          { name: "Hizone Cco500ml", amount: 7_100 },
          { name: "Ujoy Bpod Ap2ml", amount: 67_000 },
        ],
      });
      expect(parseReceipt(PADDLE_QRIS_CUT, "2026-10-30")).toMatchObject({ total: 69_900, date: "2026-09-28", payment: "QRIS" });
    });

    test("a total misread by one digit is put right by Total Item − Total Disc", () => {
      expect(parseReceipt(TESSERACT_CASH, "2026-10-30")).toMatchObject({ total: 78_200, date: "2026-10-25", merchant: "Alfamart Jati Mekar" });
    });

    // The opposite case: PaddleOCR on the app's resized upload misread Total Item (85.300 → "85.200"),
    // not the total. Total Item − Total Disc then says 80.000, one digit from the printed 80.100; the
    // items (67.000 + 10.800 + 7.500 − 5.200 = 80.100) and the QRIS line ("30.100") back the printed one.
    test("a misread Total Item doesn't overrule a total the items and payment agree with", () => {
      const MISREAD_GROSS = `JATI MEKAR 2 [JMK2]
Bon JA16-241-26099M74 Kasir : LISTI
DJOY BPOD AP2ML   1 67.000 67.000
RAMENYES CKN88G   3 3.600 10.800
Disc. -3.600
FIBE MINI 100ML   1 7.500 7.500
Disc. -1,600
Total Item 3   85.200
Total Disc.   5.200
Total Belania   80.100
QRIS CPM ALFA   30.100
Kembalian   0
PPN   DPP: 16,486 PPN: 1813
1gl. 26-09-2026 16:40:20 V.2026.7.2`;
      expect(parseReceipt(MISREAD_GROSS, "2026-10-30")).toMatchObject({ total: 80_100, date: "2026-09-26", payment: "QRIS" });
    });

    test("labels cut off or misread still count", () => {
      expect(findTotal(lines("tal Item 2 71.100\ntal Disc. 1.200\ntal Belania 69.900"))).toBe(69_900);
      expect(findTotal(lines("Tolal Belanja 78,200\nlunai 100,000\nKerbal ian 21,800"))).toBe(78_200);
      // No total label left at all: the discount arithmetic, confirmed by the QRIS payment.
      expect(findTotal(lines("Total Item 2 71.100\nTotal Disc. 1.200\nIS CPM ALFA 69.900"))).toBe(69_900);
    });

    test("the date, not the till's version number next to it", () => {
      expect(findDate(lines("Tgl. 25-10-2026 09:56:05 V.2026.7.2"), "2026-10-30")).toBe("2026-10-25");
      expect(findDate(lines("V 2026.7.2"), "2026-10-30")).toBeNull();
    });

    // A koperasi POS receipt (PaddleOCR text of a user's photo): each item is a barcode + name line
    // with the quantity row under it, and "Pel.: UMUM/CASH" (customer: general, cash) in the header.
    // The header's "CASH" used to end the item list before the first item.
    test("koperasi receipt: name line, then the quantity row with its amount", () => {
      const KOPERASI = `Koperasi Pegawai Kementerian Perhubungan
Jl. Merdeka Barat No. 8
Jakarta Pusat
Telp: - Fax: - Email: -
No. :UTM/KSR/1026/00009095   28-10-2026
Kasir: FEBY   09:12:08
Pel.:UMUM/CASH
8992907720018 - SARI ROTI SOBEK COK KEJU
1,00 PCS X   19.000,00=   19.000,00
8991002101234 - TEH BOTOL SOSRO 350ML
2,00 PCS X   5.000,00=   10.000,00
BRS=2 ,QTY=3,00   29.000,00
Tunai   30.000,00
Kembali   =   1.000,00`;
      expect(parseReceipt(KOPERASI, "2026-10-30")).toMatchObject({
        total: 29_000, date: "2026-10-28", merchant: "Koperasi Pegawai Kementerian Perhubungan", payment: "Cash",
        items: [{ name: "Sari Roti Sobek Cok Keju", amount: 19_000 }, { name: "Teh Botol Sosro 350ml", amount: 10_000 }],
      });
      // A quantity row with no name above it is not an item called "Pcs".
      expect(findItems(lines("1,00 PCS X 19.000,00= 19.000,00\nTOTAL 19.000"))).toEqual([]);
    });

    test("ordinary words that look like labels are left alone", () => {
      // "BAYAM" (spinach) is an item, not "BAYAR"; one-word item rows stay items.
      expect(findItems(lines("BAYAM 1 5.000 5.000\nTUNAS 2 3.000 6.000\nTOTAL 11.000"))).toEqual([
        { name: "Bayam", amount: 5_000 },
        { name: "Tunas", amount: 6_000 },
      ]);
    });
  });

  test("marketplace invoice: final bill after discounts, the seller not the buyer", () => {
    expect(parseReceipt(MARKETPLACE, TODAY)).toEqual({
      kind: "invoice", total: 201_000, date: "2026-10-15", merchant: "Toko Elektronik Jaya", payment: "BCA",
      items: [{ name: "Kabel USB-C 1m", amount: 70_000 }, { name: "Charger 20W", amount: 150_000 }],
    });
  });

  test("service invoice: balance due, invoice date not due date, issuer not bill-to", () => {
    expect(parseReceipt(SERVICE, TODAY)).toEqual({
      kind: "invoice", total: 4_107_000, date: "2026-10-05", merchant: "Acme Digital Studio", payment: "BCA",
      items: [{ name: "Website maintenance", amount: 2_500_000 }, { name: "Hosting 1 year", amount: 1_200_000 }],
    });
    expect(findDate(lines("Tanggal: 01/10/2026 Jatuh tempo: 15/10/2026"), TODAY)).toBe("2026-10-01");
  });

  test("utility bill: the legal name when that's all there is, not the customer", () => {
    expect(parseReceipt(PLN, TODAY)).toMatchObject({ kind: "invoice", total: 356_420, date: "2026-10-18", merchant: "Pln" });
  });

  test("empty text gives nothing, not a crash", () => {
    expect(parseReceipt("", TODAY)).toEqual({ kind: "receipt", total: null, date: null, merchant: null, payment: null, items: [] });
  });
});

describe("POST /quick-input/receipt", () => {
  const TYPES: Record<string, string> = { jpg: "image/jpeg", pdf: "application/pdf", txt: "text/plain" };
  const photo = (name = "struk.jpg", bytes: number | Uint8Array = 4096) => {
    const form = new FormData();
    const body = typeof bytes === "number" ? new Uint8Array(bytes) : bytes;
    form.append("image", new File([body], name, { type: TYPES[name.split(".").pop()!] }));
    return form;
  };
  const reads = (text: string) => setReceiptReader(async () => text);
  afterEach(() => setReceiptReader());

  test("reads the receipt into a draft: total, date, shop, category", async () => {
    const u = await newUser();
    await u.wallet("BCA", 1_000_000);
    reads(INDOMARET);
    const res = await u.call("POST", "/quick-input/receipt", photo());
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ merchant: "Indomaret", total: 40_000, payment: "Cash" });
    expect(res.data.text).toContain("INDOMARET");
    expect(res.data.items).toEqual([
      { name: "Aqua 600ml", amount: 8_000 },
      { name: "Roti Tawar Sari", amount: 16_500 },
      { name: "Indomie Goreng", amount: 15_500 },
    ]);
    expect(res.data.draft).toMatchObject({
      amount: 40_000, type: "expense", category_name: "Groceries", note: "Indomaret",
      matched: { amount: true, category: "keyword" },
    });
  });

  test("the payment method picks the matching wallet", async () => {
    const u = await newUser();
    await u.wallet("Cash", 100_000, { wallet_type: "cash" });
    const qris = await u.wallet("QRIS", 0);
    reads(CAFE);
    const res = await u.call("POST", "/quick-input/receipt", photo());
    expect(res.data.draft).toMatchObject({ wallet_id: qris.id, category_name: "Food & Drinks", matched: { wallet: "name" } });

    const cashOnly = await newUser();
    const cash = await cashOnly.wallet("Dompet", 50_000, { wallet_type: "cash" });
    reads(INDOMARET);
    expect((await cashOnly.call("POST", "/quick-input/receipt", photo())).data.draft.wallet_id).toBe(cash.id);
  });

  test("a draft from a receipt saves as a normal transaction", async () => {
    const u = await newUser();
    const cash = await u.wallet("Cash", 100_000, { wallet_type: "cash" });
    reads(INDOMARET);
    const d = (await u.call("POST", "/quick-input/receipt", photo())).data.draft;
    const saved = await u.call("POST", "/transactions", {
      wallet_id: d.wallet_id, category_id: d.category_id, type: d.type, amount: d.amount,
      transaction_date: d.transaction_date, note: d.note,
    });
    expect(saved.status).toBe(201);
    expect(await u.balance(cash.id)).toBe(60_000);
  });

  test("unreadable photos, wrong files and missing login", async () => {
    const u = await newUser();
    reads("  ~ . ,  ");
    const blurry = await u.call("POST", "/quick-input/receipt", photo());
    expect(blurry.status).toBe(422);
    expect(blurry.data.error).toContain("Couldn't read that receipt");

    reads(CAFE);
    expect((await u.call("POST", "/quick-input/receipt", new FormData())).status).toBe(400);
    expect((await u.call("POST", "/quick-input/receipt", photo("receipt.txt"))).status).toBe(415);
    expect((await u.call("POST", "/quick-input/receipt", photo("struk.jpg", 0))).status).toBe(422);
    expect((await u.call("POST", "/quick-input/receipt", photo("struk.jpg", 5 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await api("POST", "/quick-input/receipt", { body: photo() })).status).toBe(401);
  });

  test("a PDF invoice is read from its text, no OCR", async () => {
    const u = await newUser();
    const bca = await u.wallet("BCA", 1_000_000);
    setReceiptReader(async () => {
      throw new Error("PDFs must not go through OCR");
    });
    const pdf = makePdf([
      ["INVOICE", 20, 560],
      ["Penjual : Toko Elektronik Jaya", 20, 540],
      ["Tanggal Pembelian : 15 Oktober 2026", 20, 520],
      ["TOTAL HARGA", 20, 500], ["Rp220.000", 300, 500],
      ["TOTAL TAGIHAN", 20, 480], ["Rp201.000", 300, 480], // label and amount are separate pieces on one line
      ["Metode Pembayaran: BCA Virtual Account", 20, 460],
    ]);
    const res = await u.call("POST", "/quick-input/receipt", photo("invoice.pdf", pdf));
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ kind: "invoice", merchant: "Toko Elektronik Jaya", total: 201_000, date: "2026-10-15" });
    expect(res.data.text).toContain("TOTAL TAGIHAN Rp201.000");
    expect(res.data.draft).toMatchObject({ amount: 201_000, wallet_id: bca.id, note: "Toko Elektronik Jaya" });
  });

  test("the file's bytes decide its type, not the label the phone sent", async () => {
    const u = await newUser();
    const pdf = makePdf([["INVOICE", 20, 560], ["TOTAL TAGIHAN", 20, 500], ["Rp201.000", 300, 500]]);
    const unlabeled = new FormData();
    unlabeled.append("image", new File([pdf], "upload", { type: "application/octet-stream" }));
    const res = await u.call("POST", "/quick-input/receipt", unlabeled);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ kind: "invoice", total: 201_000 });

    // A JPEG (by its first bytes) labelled as something else still goes to OCR.
    reads(INDOMARET);
    const jpeg = new Uint8Array(4096);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
    const mislabeled = new FormData();
    mislabeled.append("image", new File([jpeg], "struk", { type: "" }));
    expect((await u.call("POST", "/quick-input/receipt", mislabeled)).data).toMatchObject({ total: 40_000 });
  });

  test("scanned (text-less) and broken PDFs get clear errors", async () => {
    const u = await newUser();
    const scanned = await u.call("POST", "/quick-input/receipt", photo("scan.pdf", makePdf([])));
    expect(scanned.status).toBe(422);
    expect(scanned.data.error).toContain("no text");
    const broken = await u.call("POST", "/quick-input/receipt", photo("broken.pdf", new TextEncoder().encode("not a pdf at all")));
    expect(broken.status).toBe(422);
    expect(broken.data.error).toContain("can't be opened");
  });

  test("OCR failures become a friendly 502", async () => {
    const u = await newUser();
    setReceiptReader(async () => {
      throw new HttpError(502, "Couldn't read receipts right now. Try again, or type it in");
    });
    expect((await u.call("POST", "/quick-input/receipt", photo())).status).toBe(502);
  });
});

describe("photo clean-up before OCR", () => {
  test("a small colour photo comes out grey, upright and enlarged to OCR size", async () => {
    // 400×300, rotated by its EXIF tag (orientation 6 = the phone was held sideways).
    const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 230, g: 200, b: 150 } } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const meta = await sharp(await prepareForOcr(new Uint8Array(photo))).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(1800);
    expect(meta.height).toBe(2400); // turned upright (300×400), then scaled to 1800 wide
    expect(meta.channels).toBe(1); // grey
  });

  test("something that isn't an image is passed through untouched", async () => {
    const junk = new TextEncoder().encode("not an image");
    expect(new Uint8Array(await prepareForOcr(junk))).toEqual(junk);
  });
});

describe("PaddleOCR boxes back into printed rows", () => {
  // A text box `width` wide and 30 tall at (x, y), on a page tilted by `slope` (y drops by slope per px).
  const box = (text: string, x: number, y: number, width: number, slope = 0): OcrBox => {
    const at = (px: number, py: number): [number, number] => [px, py + slope * px];
    return { text, box: [at(x, y), at(x + width, y), at(x + width, y + 30), at(x, y + 30)] };
  };

  test("a label and its amount far to the right are one row; wide gaps stay wide", () => {
    const text = rowsFromBoxes([box("80.100", 500, 102, 120), box("TOTAL", 40, 100, 110), box("ALFAMART", 40, 20, 200)]);
    expect(text).toBe("ALFAMART\nTOTAL   80.100");
  });

  test("on a tilted photo the amount stays with its label, not the row above or below", () => {
    // 8% tilt: across 600 px the right side sits 48 px lower, more than a row's height (40 px apart).
    const slope = 0.08;
    const text = rowsFromBoxes([
      box("TOTAL", 40, 100, 110, slope),
      box("80.100", 600, 100, 120, slope),
      box("TUNAI", 40, 140, 110, slope),
      box("100.000", 600, 140, 140, slope),
      box("KEMBALI", 40, 180, 150, slope),
      box("19.900", 600, 180, 120, slope),
    ]);
    expect(text).toBe("TOTAL   80.100\nTUNAI   100.000\nKEMBALI   19.900");
    expect(parseReceipt(text, TODAY).total).toBe(80_100);
  });

  test("nothing read gives empty text", () => {
    expect(rowsFromBoxes([])).toBe("");
    expect(rowsFromBoxes([box("  ", 0, 0, 10)])).toBe("");
  });
});
