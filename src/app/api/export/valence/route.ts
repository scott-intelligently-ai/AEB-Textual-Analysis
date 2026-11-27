import { valenceXlsx } from "@/server/frequency";
import { route } from "@/server/http";

export const GET = route(async () => {
  const bytes = await valenceXlsx();
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="valence.xlsx"',
    },
  });
});
