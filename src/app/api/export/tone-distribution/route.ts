import { parseDistributionGroup, toneDistributionCsv } from "@/server/distribution";
import { parseIdList, route } from "@/server/http";

export const GET = route(async (request) => {
  const params = request.nextUrl.searchParams;
  const group = parseDistributionGroup(params.get("group"));
  const csv = await toneDistributionCsv(group, parseIdList(params.get("ids")));
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tone-distribution-${group}.csv"`,
    },
  });
});
