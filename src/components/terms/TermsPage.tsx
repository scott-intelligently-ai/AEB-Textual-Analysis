"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import useSWR from "swr";
import { useFeedback } from "@/components/feedback";
import { PencilIcon, PlusIcon, TrashIcon, UploadIcon } from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  IconButton,
  LoadingBlock,
  Modal,
  Notice,
  PageHeader,
  TextArea,
  TextInput,
} from "@/components/ui";
import { errorMessage, fetcher, send } from "@/lib/client/api";
import type { FrequencyTable, ImportResult, Term } from "@/lib/client/types";
import { guessCommaMode, parseTermList, type CommaMode } from "@/lib/text/csv";

const splitVariants = (value: string) =>
  value
    .split(/[,;\n]/)
    .map((variant) => variant.trim())
    .filter(Boolean);

export function TermsPage() {
  const { notify, notifyError, confirm } = useFeedback();
  const terms = useSWR<Term[]>("/api/terms", fetcher);
  const frequency = useSWR<FrequencyTable>("/api/frequency", fetcher);

  const [text, setText] = useState("");
  const [variants, setVariants] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Term | null>(null);
  const [importing, setImporting] = useState(false);
  const termField = useRef<HTMLInputElement>(null);

  const totals = new Map(frequency.data?.rows.map((row) => [row.termId, row.total]) ?? []);
  const documentCount = frequency.data?.documents.length ?? 0;

  async function add() {
    setAdding(true);
    setAddError(null);
    try {
      await send("POST", "/api/terms", { text, variants: splitVariants(variants) });
      setText("");
      setVariants("");
      termField.current?.focus();
    } catch (error) {
      setAddError(errorMessage(error));
    } finally {
      setAdding(false);
    }
  }

  async function remove(term: Term) {
    const ok = await confirm({
      title: `Remove “${term.text}” from the term list?`,
      body: "It will no longer be counted or highlighted, and any tone tags recorded for it are deleted.",
      confirmLabel: "Remove term",
      danger: true,
    });
    if (!ok) return;
    try {
      await send("DELETE", `/api/terms/${term.id}`);
      notify(`Removed “${term.text}”.`);
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <>
      <PageHeader
        title="Terms"
        description={
          <>
            The words and phrases the analysis counts and highlights. Matching ignores case and only
            matches whole words, so “tax” does not match “taxes”; list other forms as variants to
            count them under the same term. Not sure what you are missing?{" "}
            <Link href="/discover" className="font-medium text-indigo-700 hover:underline">
              Let the AI look for overlooked terms
            </Link>
            .
          </>
        }
        actions={
          <Button onClick={() => setImporting(true)}>
            <UploadIcon /> Import a list
          </Button>
        }
      />

      <Card className="mb-6 p-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) void add();
          }}
        >
          <label className="min-w-48 flex-1">
            <span className="mb-1 block text-xs font-medium text-zinc-600">Term</span>
            <TextInput
              ref={termField}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="e.g. freedom"
            />
          </label>
          <label className="min-w-64 flex-[2]">
            <span className="mb-1 block text-xs font-medium text-zinc-600">
              Variants counted as the same term (optional, separated by commas)
            </span>
            <TextInput
              value={variants}
              onChange={(event) => setVariants(event.target.value)}
              placeholder="e.g. freedoms, liberty"
            />
          </label>
          <Button type="submit" variant="primary" busy={adding} disabled={!text.trim()}>
            <PlusIcon /> Add term
          </Button>
        </form>
        {addError ? (
          <div className="mt-3">
            <Notice tone="red">{addError}</Notice>
          </div>
        ) : null}
      </Card>

      {terms.error ? (
        <ErrorBlock error={terms.error} />
      ) : !terms.data ? (
        <LoadingBlock />
      ) : terms.data.length === 0 ? (
        <EmptyState title="No terms yet">
          Add terms one at a time above, or import a list you already have.
        </EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium text-zinc-500">
              <tr>
                <th className="px-4 py-2">Term</th>
                <th className="px-2 py-2">Variants</th>
                <th className="px-2 py-2 text-right">
                  Uses in {documentCount} document{documentCount === 1 ? "" : "s"}
                </th>
                <th className="w-20 px-4 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {terms.data.map((term) => (
                <tr key={term.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-2.5 font-medium text-zinc-900">{term.text}</td>
                  <td className="px-2 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {term.variants.length === 0 ? (
                        <span className="text-zinc-400">None</span>
                      ) : (
                        term.variants.map((variant) => <Badge key={variant}>{variant}</Badge>)
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-right text-zinc-700 tabular-nums">
                    {totals.get(term.id)?.toLocaleString() ?? "–"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <IconButton label={`Edit ${term.text}`} onClick={() => setEditing(term)}>
                        <PencilIcon />
                      </IconButton>
                      <IconButton label={`Remove ${term.text}`} onClick={() => remove(term)}>
                        <TrashIcon />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {editing ? <EditTermDialog term={editing} onClose={() => setEditing(null)} /> : null}
      {importing ? <ImportDialog onClose={() => setImporting(false)} /> : null}
    </>
  );
}

function EditTermDialog({ term, onClose }: { term: Term; onClose: () => void }) {
  const [text, setText] = useState(term.text);
  const [variants, setVariants] = useState(term.variants.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await send("PATCH", `/api/terms/${term.id}`, { text, variants: splitVariants(variants) });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Edit term"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!text.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) void save();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">Term</span>
          <TextInput autoFocus value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            Variants (separated by commas)
          </span>
          <TextInput value={variants} onChange={(event) => setVariants(event.target.value)} />
        </label>
        <p className="text-xs leading-5 text-zinc-500">
          Tone tags stay on the places that still match. Tags on wording you remove here are
          deleted.
        </p>
        {error ? <Notice tone="red">{error}</Notice> : null}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<CommaMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const effectiveMode = mode ?? guessCommaMode(input);
  const parsed = parseTermList(input, effectiveMode);
  const hasCommas = input.includes(",");

  async function readFile(file: File | undefined) {
    if (!file) return;
    setInput(await file.text());
    setMode(null);
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await send<ImportResult>("POST", "/api/terms/import", { terms: parsed }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Modal
        title="Import finished"
        onClose={onClose}
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="space-y-3">
          <p>
            Added {result.added.length} term{result.added.length === 1 ? "" : "s"}.
            {result.skipped.length > 0
              ? ` ${result.skipped.length} ${result.skipped.length === 1 ? "was" : "were"} not added:`
              : ""}
          </p>
          {result.skipped.length > 0 ? (
            <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-amber-900 ring-1 ring-amber-200 ring-inset">
              {result.skipped.map((item) => (
                <li key={item.text}>{item.reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Import a list of terms"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={parsed.length === 0} onClick={run}>
            Import {parsed.length} term{parsed.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>Paste your list with one term per line, or choose a CSV or text file.</p>
          <label className="cursor-pointer rounded-md bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 shadow-sm ring-1 ring-zinc-300 ring-inset hover:bg-zinc-50">
            Choose file
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={(event) => void readFile(event.target.files?.[0])}
            />
          </label>
        </div>
        <TextArea
          rows={8}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={"freedom, freedoms, liberty\nSoviet Union\npeace"}
          aria-label="Terms to import"
          className="font-mono"
        />
        {hasCommas ? (
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs font-medium text-zinc-600">
              How should commas be read?
            </legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="comma-mode"
                className="accent-indigo-600"
                checked={effectiveMode === "variants"}
                onChange={() => setMode("variants")}
              />
              The first word on a line is the term; the rest are its variants
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="comma-mode"
                className="accent-indigo-600"
                checked={effectiveMode === "terms"}
                onChange={() => setMode("terms")}
              />
              Every comma-separated word is a term of its own
            </label>
          </fieldset>
        ) : null}
        {parsed.length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-medium text-zinc-600">
              This will add {parsed.length} term{parsed.length === 1 ? "" : "s"}
            </p>
            <ul className="max-h-48 divide-y divide-zinc-100 overflow-y-auto rounded-lg ring-1 ring-zinc-200">
              {parsed.map((term) => (
                <li key={term.text} className="flex flex-wrap items-center gap-1.5 px-3 py-1.5">
                  <span className="font-medium text-zinc-900">{term.text}</span>
                  {term.variants.map((variant) => (
                    <Badge key={variant}>{variant}</Badge>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? <Notice tone="red">{error}</Notice> : null}
      </div>
    </Modal>
  );
}
