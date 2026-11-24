import { getToneDistribution, parseDistributionGroup } from "@/server/distribution";
import { parseIdList, route } from "@/server/http";

export const GET = route((request) => {
  const params = request.nextUrl.searchParams;
  return getToneDistribution(parseDistributionGroup(params.get("group")), parseIdList(params.get("ids")));
});
