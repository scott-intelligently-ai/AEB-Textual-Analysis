"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { DownloadIcon } from "@/components/icons";
import {
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Notice,
  PageHeader,
  cx,
} from "@/components/ui";
import { downloadText, fetcher } from "@/lib/client/api";
import type { DocumentSummary, FrequencyTable } from "@/lib/client/types";
import { toCsv } from "@/lib/text/csv";

type Sort = "list" | "total";

export function FrequencyPage({ embedded = false }: { embedded?: boolean }) {
  const documents = useSWR<DocumentSummary[]>("/api/documents", fetcher);
  // null means "all documents", including any added later.
  const [chosen, setChosen] = useState<number[] | null>(null);
  const [sort, setSort] = useState<Sort>("total");

  const all = documents.data ?? [];
  const selected = chosen === null ? all.map((d) => d.id) : chosen.filter((id) => all.some((d) => d.id === id));
  const everything = selected.length === all.length;
  const query = everything ? "" : `?ids=${selected.join(",")}`;

  const table = useSWR<FrequencyTable>(
    documents.data && selected.length > 0 ? `/api/frequency${query}` : null,
    fetcher,
    { keepPreviousData: true },
  );

  function toggle(id: number) {
    const next = selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id];
    setChosen(next.length === all.length ? null : next);
  }

  function exportCounts(data: FrequencyTable) {
    const rows: (string | number)[][] = [
      ["term", ...data.documents.map((d) => d.title), "total"],
      ...data.rows.map((row) => [row.term, ...row.counts, row.total]),
      ["total", ...data.documents.map((d) => d.total), data.grandTotal],
    ];
    downloadText("term-frequency.csv", toCsv(rows));
  }

  if (documents.error) return <ErrorBlock error={documents.error} />;
  if (!documents.data) return <LoadingBlock />;

  const data = selected.length > 0 ? table.data : undefined;
  const rows = data
    ? sort === "total"
      ? [...data.rows].sort((a, b) => b.total - a.total)
      : data.rows
    : [];

  const exportActions =
    data && data.rows.length > 0 ? (
      <>
        <Button onClick={() => exportCounts(data)}>
          <DownloadIcon /> Export counts (CSV)
        </Button>
        <a
          href={`/api/export/occurrences${query}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm ring-1 ring-zinc-300 ring-inset hover:bg-zinc-50"
        >
          <DownloadIcon /> Export every occurrence with its tone
        </a>
      </>
    ) : null;

  return (
    <>
      {embedded ? (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900">Frequency</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-600">
              How often each term appears, in every document or only the ones you choose. Variants
              are counted under their term.
            </p>
          </div>
          {exportActions ? (
            <div className="flex flex-wrap items-center gap-2">{exportActions}</div>
          ) : null}
        </div>
      ) : (
        <PageHeader
          title="Frequency"
          description="How often each term appears, in every document or only the ones you choose. Variants are counted under their term."
          actions={exportActions}
        />
      )}

      {all.length === 0 ? (
        <EmptyState
          title="No documents to count yet"
          action={
            <Link
              href="/"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Go to documents
            </Link>
          }
        >
          Upload a scan and create a document from it first.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <Card className="self-start p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">Documents</h2>
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
            <ul className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto">
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
              <Notice>Choose at least one document to count.</Notice>
            ) : table.error ? (
              <ErrorBlock error={table.error} />
            ) : !data ? (
              <LoadingBlock label="Counting" />
            ) : data.rows.length === 0 ? (
              <EmptyState
                title="No terms to count yet"
                action={
                  <Link
                    href="/terms"
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
                  >
                    Add terms
                  </Link>
                }
              >
                Add the terms you want to analyse and their counts will appear here.
              </EmptyState>
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
                    <tr>
                      <th className="sticky left-0 bg-zinc-50 px-4 py-2 text-left">
                        <button
                          type="button"
                          onClick={() => setSort("list")}
                          className={cx("hover:text-zinc-900", sort === "list" && "text-zinc-900")}
                          title="Sort in term list order"
                        >
                          Term{sort === "list" ? " ↓" : ""}
                        </button>
                      </th>
                      {data.documents.map((document) => (
                        <th key={document.id} className="max-w-40 px-3 py-2 text-right align-bottom">
                          <Link
                            href={`/documents/${document.id}`}
                            className="line-clamp-2 hover:text-indigo-700 hover:underline"
                            title={document.title}
                          >
                            {document.title}
                          </Link>
                        </th>
                      ))}
                      <th className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setSort("total")}
                          className={cx("hover:text-zinc-900", sort === "total" && "text-zinc-900")}
                          title="Sort by total, highest first"
                        >
                          Total{sort === "total" ? " ↓" : ""}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {rows.map((row) => (
                      <tr key={row.termId} className="hover:bg-zinc-50">
                        <th
                          scope="row"
                          className="sticky left-0 bg-white px-4 py-2 text-left font-medium text-zinc-900"
                        >
                          {row.term}
                        </th>
                        {row.counts.map((count, index) => (
                          <td
                            key={data.documents[index].id}
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
                  <tfoot className="border-t border-zinc-200 bg-zinc-50 font-semibold text-zinc-900">
                    <tr>
                      <th scope="row" className="sticky left-0 bg-zinc-50 px-4 py-2 text-left">
                        All terms
                      </th>
                      {data.documents.map((document) => (
                        <td key={document.id} className="px-3 py-2 text-right tabular-nums">
                          {document.total.toLocaleString()}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right tabular-nums">
                        {data.grandTotal.toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
