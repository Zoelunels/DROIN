import { afterEach, describe, expect, test } from "bun:test";
import { normalizeSpokenAmounts, parseAmount, splitItems } from "../src/services/quickInput";
import { setTranscriber } from "../src/services/speech";
import { addDays } from "../src/time";
import { api, newUser, today } from "./helpers";

// A tiny fake recording; the transcriber is replaced, so the bytes never leave the test.
// Bun derives the part type from the file name when parsing multipart, so the name sets the type.
const clip = (name = "voice.m4a", bytes = 2048, type = "audio/m4a") => {
  const form = new FormData();
  form.append("audio", new File([new Uint8Array(bytes)], name, { type }));
  return form;
};
const hears = (text: string) => {
  const calls: { language: string; prompt: string }[] = [];
  setTranscriber(async (_audio, options) => {
    calls.push(options);
    return text;
  });
  return calls;
};

afterEach(() => setTranscriber());

describe("spoken amounts", () => {
  test("Indonesian number words and slang become amounts", () => {
    const amount = (t: string) => parseAmount(normalizeSpokenAmounts(t))?.amount ?? null;
    expect(amount("makan dua puluh lima ribu")).toBe(25_000);
    expect(amount("parkir lima belas ribu")).toBe(15_000);
    expect(amount("seratus dua puluh ribu")).toBe(120_000);
    expect(amount("seribu")).toBe(1_000);
    expect(amount("gaji delapan juta")).toBe(8_000_000);
    expect(amount("satu juta dua ratus lima puluh ribu")).toBe(1_250_000);
    expect(amount("satu setengah juta")).toBe(1_500_000);
    expect(amount("satu koma lima juta")).toBe(1_500_000);
    expect(amount("setengah juta")).toBe(500_000);
    expect(amount("lima ratus")).toBe(500);
    expect(amount("parkir goceng")).toBe(5_000);
    expect(amount("dua ceban")).toBe(20_000);
  });

  test("leaves ordinary words and digit amounts alone", () => {
    expect(normalizeSpokenAmounts("dua kopi 30k")).toBe("dua kopi 30k");
    expect(normalizeSpokenAmounts("makan 25 ribu pakai gopay")).toBe("makan 25 ribu pakai gopay");
    expect(normalizeSpokenAmounts("bensin 50 rb")).toBe("bensin 50 rb");
  });

  test("splits a list only when every item has an amount", () => {
    expect(splitItems("kopi 25 ribu, parkir goceng")).toEqual(["kopi 25 ribu", "parkir Rp5000"]);
    expect(splitItems("makan 30k terus bensin 20k")).toEqual(["makan 30k", "bensin 20k"]);
    expect(splitItems("makan, minum 30k")).toEqual(["makan, minum 30k"]);
    expect(splitItems("gaji 1,5jt")).toEqual(["gaji 1,5jt"]);
  });
});

describe("POST /quick-input/voice", () => {
  test("transcribes and parses into a draft", async () => {
    const u = await newUser();
    await u.wallet("BCA", 1_000_000);
    const gopay = await u.wallet("GoPay", 100_000);
    const calls = hears("Makan dua puluh lima ribu pakai GoPay kemarin.");

    const res = await u.call("POST", "/quick-input/voice", clip());
    expect(res.status).toBe(200);
    expect(res.data.transcript).toBe("Makan dua puluh lima ribu pakai GoPay kemarin.");
    expect(res.data.drafts).toHaveLength(1);
    expect(res.data.drafts[0]).toMatchObject({
      amount: 25_000, type: "expense", category_name: "Food & Drinks", wallet_id: gopay.id,
      transaction_date: addDays(today(), -1), note: "Makan",
    });
    // Indonesian by default, and the user's wallet names are passed as a spelling hint.
    expect(calls[0]!.language).toBe("id");
    expect(calls[0]!.prompt).toContain("GoPay");
  });

  test("mixed Indonesian/English with several items shares the spoken date", async () => {
    const u = await newUser();
    await u.wallet("Cash", 500_000);
    hears("Coffee 18rb, parkir goceng kemarin");
    const res = await u.call("POST", "/quick-input/voice", clip());
    expect(res.status).toBe(200);
    const [coffee, parking] = res.data.drafts;
    expect(coffee).toMatchObject({ amount: 18_000, category_name: "Food & Drinks", transaction_date: addDays(today(), -1) });
    expect(parking).toMatchObject({ amount: 5_000, category_name: "Transport", transaction_date: addDays(today(), -1) });
  });

  test("a draft can be saved as a transaction", async () => {
    const u = await newUser();
    const cash = await u.wallet("Cash", 100_000);
    hears("bensin 50 ribu cash");
    const draft = (await u.call("POST", "/quick-input/voice", clip())).data.drafts[0];
    const saved = await u.call("POST", "/transactions", {
      wallet_id: draft.wallet_id, category_id: draft.category_id, type: draft.type,
      amount: draft.amount, transaction_date: draft.transaction_date, note: draft.note,
    });
    expect(saved.status).toBe(201);
    expect(await u.balance(cash.id)).toBe(50_000);
  });

  test("silence, noise and the usual Whisper hallucinations → 422", async () => {
    const u = await newUser();
    for (const heard of ["", "   ", "Terima kasih.", "Thanks for watching!"]) {
      hears(heard);
      const res = await u.call("POST", "/quick-input/voice", clip());
      expect(res.status).toBe(422);
      expect(res.data.error).toContain("Didn't catch that");
    }
  });

  test("speech without an amount still returns a draft to fill in", async () => {
    const u = await newUser();
    hears("makan siang");
    const res = await u.call("POST", "/quick-input/voice", clip());
    expect(res.status).toBe(200);
    expect(res.data.drafts[0]).toMatchObject({ amount: null, matched: { amount: false } });
  });

  test("rejects missing, empty, oversized and non-audio uploads", async () => {
    const u = await newUser();
    hears("kopi 20k");
    expect((await u.call("POST", "/quick-input/voice", new FormData())).status).toBe(400);
    expect((await u.call("POST", "/quick-input/voice", { audio: "x" })).status).toBe(400);
    expect((await u.call("POST", "/quick-input/voice", clip("receipt.png", 2048, "image/png"))).status).toBe(415);
    expect((await u.call("POST", "/quick-input/voice", clip("voice.m4a", 0))).status).toBe(422);
    expect((await u.call("POST", "/quick-input/voice", clip("voice.m4a", 3 * 1024 * 1024 + 1))).status).toBe(413);
  });

  test("needs a login", async () => {
    expect((await api("POST", "/quick-input/voice", { body: clip() })).status).toBe(401);
  });

  test("503 when no speech-to-text key is configured", async () => {
    const u = await newUser();
    const saved = process.env.STT_API_KEY;
    delete process.env.STT_API_KEY;
    try {
      const res = await u.call("POST", "/quick-input/voice", clip());
      expect(res.status).toBe(503);
    } finally {
      if (saved !== undefined) process.env.STT_API_KEY = saved;
    }
  });

  test("provider errors → 502", async () => {
    const u = await newUser();
    const saved = { key: process.env.STT_API_KEY, url: process.env.STT_API_URL };
    process.env.STT_API_KEY = "test-key";
    process.env.STT_API_URL = "http://127.0.0.1:9/v1"; // nothing listens on the discard port
    try {
      const res = await u.call("POST", "/quick-input/voice", clip());
      expect(res.status).toBe(502);
    } finally {
      if (saved.key === undefined) delete process.env.STT_API_KEY;
      else process.env.STT_API_KEY = saved.key;
      if (saved.url === undefined) delete process.env.STT_API_URL;
      else process.env.STT_API_URL = saved.url;
    }
  });
});
