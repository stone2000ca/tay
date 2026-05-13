export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    status: "ok",
    version: "0.0.1",
    timestamp: new Date().toISOString(),
  });
}
