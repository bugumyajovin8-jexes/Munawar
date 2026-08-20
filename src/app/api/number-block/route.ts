import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";

/**
 * Lend this device a range of invoice numbers to use offline.
 *
 * The allocation itself is a single atomic step in the database — the same row
 * lock on document_counters that hands out one number at a time online, moved
 * on by the size of the block instead. So a number issued from a laptop and a
 * range lent to a phone can never collide, and two devices asking at the same
 * instant queue rather than clash.
 *
 * The size the client asks for is a request, not an instruction: the function
 * clamps it. A device that asked for a million numbers would get five hundred.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { deviceId?: string; docType?: string; year?: number; size?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!body.deviceId) {
    return Response.json({ error: "No device id." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("allocate_number_block", {
    p_device: body.deviceId,
    p_doc_type: body.docType ?? "invoice",
    p_year: body.year ?? new Date().getFullYear(),
    p_size: body.size ?? 25,
  });

  if (error) {
    // Includes "this device is registered to someone else", which is a real
    // refusal rather than a fault: a device belongs to one person in one org.
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json(data, { headers: { "cache-control": "no-store" } });
}
