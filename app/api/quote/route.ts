import { calculateQuote } from "@/lib/pricing";
import { validateQuoteInput } from "@/lib/validation";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a valid JSON body." }, { status: 400 });
  }

  const validation = validateQuoteInput(body);

  if (!validation.ok) {
    return Response.json(
      { error: "Check the price request.", fields: validation.errors },
      { status: 400 },
    );
  }

  return Response.json(
    calculateQuote(
      validation.data["Job Type"],
      validation.data["Distance (miles)"],
    ),
    { headers: { "Cache-Control": "no-store" } },
  );
}