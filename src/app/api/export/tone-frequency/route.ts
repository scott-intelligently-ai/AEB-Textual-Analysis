import { toneFrequencyCsv } from "@/server/frequency";
import { parseIdList, route } from "@/server/http";

export const GET = route(async (request) => {
  const csv = await toneFrequencyCsv(parseIdList(request.nextUrl.searchParams.get("ids")));
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="term-counts-by-tone.csv"',
    },
  });
});
