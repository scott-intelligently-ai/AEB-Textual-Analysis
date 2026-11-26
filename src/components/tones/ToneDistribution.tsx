"use client";

import { useState } from "react";
import useSWR from "swr";
import { DownloadIcon } from "@/components/icons";
import { Button, Card, EmptyState, ErrorBlock, LoadingBlock, Notice, cx } from "@/components/ui";
import { fetcher } from "@/lib/client/api";
import type { DistributionGroup, DocumentSummary, ToneDistribution } from "@/lib/client/types";
import { EQUIVALENCE_MEANING, VARIANT_MEANING } from "@/lib/text/explanations";

const GROUPS: { id: DistributionGroup; label: string; column: string }[] = [
  { id: "term", label: "Individual term", column: "Term" },
  { id: "equivalence", label: "Equivalent terms", column: "Equivalent terms" },
  { id: "category", label: "Category", column: "Category" },
  { id: "subcategory", label: "Subcategory", column: "Subcategory" },
  { id: "document", label: "Document", column: "Document" },
  { id: "overall", label: "Overall", column: "Scope" },
];

export function ToneDistributionPanel() {
  const documents = useSWR<DocumentSummary[]>("/api/documents", fetcher);
  const [group, setGroup] = useState<DistributionGroup>("term");
  const [chosen, setChosen] = useState<number[] | null>(null);

  const all = documents.data ?? [];
  const selected = chosen === null ? all.map((document) => document.id) : chosen.filter((id) => all.some((document) => document.id === id));
  const everything = all.length > 0 && selected.length === all.length;
  const query = new URLSearchParams({ group });
  if (!everything) query.set("ids", selected.join(","));
  const search = `?${query.toString()}`;

  const table = useSWR<ToneDistribution>(
    documents.data && (all.length === 0 || selected.length > 0) ? `/api/tone-distribution${search}` : null,
    fetcher,
    { keepPreviousData: true },
  );

  function toggle(id: number) {
    const next = selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id];
    setChosen(next.length === all.length ? null : next);
  }

  const column = GROUPS.find((item) => item.id === group)?.column ?? "Group";

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900">Tone distribution</h2>
          <div className="mt-1 max-w-3xl space-y-2 text-sm leading-6 text-zinc-600">
            <p>
              How the tones are spread across terms. Every occurrence counts, and an occurrence
              with no tone of its own uses the default tone. {VARIANT_MEANING}
            </p>
            <p>
              {EQUIVALENCE_MEANING} A term that is not in a group appears on its own in that view. A
              category includes its subcategories, while a subcategory counts only the terms
              assigned to it. A term in more than one category is counted in each, so category
              totals can add up to more than the overall total. The downloaded CSV begins with the
              same explanation for the view you have selected. The term and equivalent-terms
              downloads also list the categories for each term.
            </p>
          </div>
        </div>
        {table.data && table.data.rows.length > 0 ? (
          <a
            href={`/api/export/tone-distribution${search}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm ring-1 ring-zinc-300 ring-inset hover:bg-zinc-50"
          >
            <DownloadIcon /> Download this distribution (CSV)
          </a>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="text-sm text-zinc-600">
          <span className="mb-1 block text-xs font-medium">Show by</span>
          <select
            value={group}
            onChange={(event) => setGroup(event.target.value as DistributionGroup)}
            className="rounded-md bg-white px-2 py-1.5 text-sm text-zinc-900 ring-1 ring-zinc-300 ring-inset"
          >
            {GROUPS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {documents.error ? (
        <ErrorBlock error={documents.error} />
      ) : !documents.data ? (
        <LoadingBlock />
      ) : all.length === 0 ? (
        <EmptyState title="No documents to distribute yet">
          Create a document first. The distribution of its tones will appear here.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <Card className="self-start p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">Documents</h3>
              <span className="text-xs text-zinc-500">
                {selected.length} of {all.length}
              </span>
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" disabled={everything} onClick={() => setChosen(null)}>
                All
              </Button>
              <Button size="sm" disabled={selected.length === 0} onClick={() => setChosen([])}>
                None
              </Button>
            </div>
            <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
              {all.map((document) => (
                <li key={document.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-zinc-50">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 rounded border-zinc-300 accent-indigo-600"
                      checked={selected.includes(document.id)}
                      onChange={() => toggle(document.id)}
                    />
                    <span className="min-w-0 break-words text-zinc-800">{document.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          </Card>

          <div className="min-w-0">
            {selected.length === 0 ? (
              <Notice>Choose at least one document.</Notice>
            ) : table.error ? (
              <ErrorBlock error={table.error} />
            ) : !table.data ? (
              <LoadingBlock label="Counting tones" />
            ) : table.data.rows.length === 0 ? (
              <EmptyState title="Nothing to show for this view">
                {group === "subcategory"
                  ? "Add a subcategory and assign terms to it."
                  : group === "category"
                    ? "Add a category and assign terms to it."
                    : "Add terms to see how their tones are distributed."}
              </EmptyState>
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
                    <tr>
                      <th className="sticky left-0 bg-zinc-50 px-4 py-2 text-left">{column}</th>
                      {table.data.tones.map((tone) => (
                        <th key={tone.id} className="px-3 py-2 text-right">
                          {tone.name}
                        </th>
                      ))}
                      <th className="px-4 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {table.data.rows.map((row) => (
                      <tr key={row.id} className="hover:bg-zinc-50">
                        <th
                          scope="row"
                          className="sticky left-0 bg-white px-4 py-2 text-left font-medium text-zinc-900"
                        >
                          {row.label}
                        </th>
                        {row.counts.map((count, index) => (
                          <td
                            key={table.data?.tones[index]?.id ?? index}
                            className={cx(
                              "px-3 py-2 text-right tabular-nums",
                              count === 0 ? "text-zinc-300" : "text-zinc-800",
                            )}
                          >
                            {count.toLocaleString()}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right font-semibold text-zinc-900 tabular-nums">
                          {row.total.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
