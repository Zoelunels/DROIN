// Serves the brand intro animations locally: bun frontend/animation/serve.ts
//   /        → DROIN
//   /pageno  → Pageno
//   /ad      → DROIN 15s spot
//   /summer  → DROIN 15s summer spot (beat-synced to your song)
const port = Number(process.env.PORT ?? 5173);

const pages: Record<string, string> = {
  "/": "./index.html",
  "/pageno": "./pageno.html",
  "/ad": "./droin-ad.html",
  "/summer": "./droin-summer.html",
};

Bun.serve({
  port,
  fetch(req) {
    const file = pages[new URL(req.url).pathname];
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(new URL(file, import.meta.url)));
  },
});

console.log(`DROIN  → http://localhost:${port}`);
console.log(`Pageno → http://localhost:${port}/pageno`);
console.log(`Spot   → http://localhost:${port}/ad`);
console.log(`Summer → http://localhost:${port}/summer`);
