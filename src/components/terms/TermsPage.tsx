"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import useSWR from "swr";
import { DiscoverPage } from "@/components/discover/DiscoverPage";
import { TaxonomyPanel, categoryLabel } from "@/components/terms/TaxonomyPanel";
import { useFeedback } from "@/components/feedback";
import { DownloadIcon, PencilIcon, PlusIcon, SparklesIcon, TrashIcon, UploadIcon } from "@/components/icons";
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
  cx,
} from "@/components/ui";
import { downloadText, errorMessage, fetcher, send } from "@/lib/client/api";
import type { FrequencyTable, ImportResult, Term, TermCategory, TermEquivalence } from "@/lib/client/types";
import {
  countTermsToImport,
  guessCommaMode,
  importUsesColumns,
  parseTermList,
  type CommaMode,
} from "@/lib/text/csv";
import { EQUIVALENCE_MEANING, TERM_IMPORT_TEMPLATE, VARIANT_MEANING } from "@/lib/text/explanations";

const splitVariants = (value: string) =>
  value
    .split(/[,;\n]/)
    .map((variant) => variant.trim())
    .filter(Boolean);

export function TermsPage() {
  const router = useRouter();
  const discovering = useSearchParams().get("discover") === "1";
  const { notify, notifyError, confirm } = useFeedback();
  const terms = useSWR<Term[]>("/api/terms", fetcher);
  const categories = useSWR<TermCategory[]>("/api/term-categories", fetcher);
  const groups = useSWR<TermEquivalence[]>("/api/term-equivalences", fetcher);
  const frequency = useSWR<FrequencyTable>("/api/frequency", fetcher);

  const [text, setText] = useState("");
  const [variants, setVariants] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
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
      await send("POST", "/api/terms", {
        text,
        variants: splitVariants(variants),
        caseSensitive,
      });
      setText("");
      setVariants("");
      setCaseSensitive(false);
      termField.current?.focus();
    } catch (error) {
      setAddError(errorMessage(error));
    } finally {
      setAdding(false);
    }
  }

  async function setCase(term: Term, next: boolean) {
    try {
      await send("PATCH", `/api/terms/${term.id}`, {
        text: term.text,
        variants: term.variants,
        caseSensitive: next,
      });
    } catch (error) {
      notifyError(error);
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

  if (discovering) {
    return (
      <>
        <button
          type="button"
          onClick={() => router.push("/terms")}
          className="mb-4 text-xs font-medium text-indigo-700 hover:underline"
        >
          ← Terms
        </button>
        <DiscoverPage />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Terms"
        description={
          <>
            <span className="block">
              The words and phrases the analysis counts and highlights. Matching ignores case
              unless Match case is checked for that term, and it only matches whole words, so
              “tax” does not match “taxes”. A term can sit in any number of categories.
            </span>
            <span className="mt-2 block">{VARIANT_MEANING}</span>
            <span className="mt-2 block">{EQUIVALENCE_MEANING}</span>
          </>
        }
        actions={
          <>
            <Button onClick={() => router.push("/terms?discover=1")}>
              <SparklesIcon /> Discover terms
            </Button>
            <Button onClick={() => setImporting(true)}>
              <UploadIcon /> Import a list
            </Button>
          </>
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
              Variants: other spellings or plurals, separated by commas
            </span>
            <TextInput
              value={variants}
              onChange={(event) => setVariants(event.target.value)}
              placeholder="e.g. wars"
            />
          </label>
          <Button type="submit" variant="primary" busy={adding} disabled={!text.trim()}>
            <PlusIcon /> Add term
          </Button>
          <MatchCaseChoice
            checked={caseSensitive}
            onChange={setCaseSensitive}
            className="basis-full"
          />
        </form>
        {addError ? (
          <div className="mt-3">
            <Notice tone="red">{addError}</Notice>
          </div>
        ) : null}
      </Card>

      <TaxonomyPanel terms={terms.data ?? []} />

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
                <th className="px-2 py-2">Match case</th>
                <th className="px-2 py-2">Variants</th>
                <th className="px-2 py-2">Categories</th>
                <th className="px-2 py-2">Equivalent with</th>
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
                    <input
                      type="checkbox"
                      aria-label={`Match case for ${term.text}`}
                      className="size-4 rounded border-zinc-300 accent-indigo-600"
                      checked={term.caseSensitive}
                      onChange={(event) => void setCase(term, event.target.checked)}
                    />
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {term.variants.length === 0 ? (
                        <span className="text-zinc-400">None</span>
                      ) : (
                        term.variants.map((variant) => <Badge key={variant}>{variant}</Badge>)
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <CategoryBadges term={term} categories={categories.data ?? []} />
                  </td>
                  <td className="px-2 py-2.5 text-zinc-700">
                    {groups.data?.find((group) => group.id === term.equivalenceId)?.name ?? (
                      <span className="text-zinc-400">None</span>
                    )}
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

      {editing ? (
        <EditTermDialog
          term={editing}
          categories={categories.data ?? []}
          groups={groups.data ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {importing ? <ImportDialog onClose={() => setImporting(false)} /> : null}
    </>
  );
}

function MatchCaseChoice({
  checked,
  onChange,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label className={cx("flex items-start gap-2 text-sm text-zinc-700", className)}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 rounded border-zinc-300 accent-indigo-600"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span className="font-medium">Match case</span>
        <span className="mt-0.5 block text-xs text-zinc-500">
          Only count this term and its variants when the capital letters match.
        </span>
      </span>
    </label>
  );
}

function CategoryBadges({ term, categories }: { term: Term; categories: TermCategory[] }) {
  const labels = categories
    .filter((category) => term.categoryIds.includes(category.id))
    .map((category) => categoryLabel(category, categories))
    .sort((a, b) => a.localeCompare(b));
  if (labels.length === 0) return <span className="text-zinc-400">None</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <Badge key={label} tone="indigo">
          {label}
        </Badge>
      ))}
    </div>
  );
}

function EditTermDialog({
  term,
  categories,
  groups,
  onClose,
}: {
  term: Term;
  categories: TermCategory[];
  groups: TermEquivalence[];
  onClose: () => void;
}) {
  const [text, setText] = useState(term.text);
  const [variants, setVariants] = useState(term.variants.join(", "));
  const [caseSensitive, setCaseSensitive] = useState(term.caseSensitive);
  const [categoryIds, setCategoryIds] = useState<number[]>(term.categoryIds);
  const [equivalenceId, setEquivalenceId] = useState<number | "">(term.equivalenceId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parents = categories.filter((category) => category.parentId === null);

  function toggleCategory(id: number) {
    setCategoryIds((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await send("PATCH", `/api/terms/${term.id}`, {
        text,
        variants: splitVariants(variants),
        caseSensitive,
      });
      await send("PUT", `/api/terms/${term.id}/categories`, { categoryIds });
      await send("PUT", `/api/terms/${term.id}/equivalence`, {
        equivalenceId: equivalenceId === "" ? null : equivalenceId,
      });
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
            Variants: other spellings or plurals, separated by commas
          </span>
          <TextInput value={variants} onChange={(event) => setVariants(event.target.value)} />
        </label>
        <MatchCaseChoice checked={caseSensitive} onChange={setCaseSensitive} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            Equivalent group (optional; the terms stay separate)
          </span>
          <select
            value={equivalenceId}
            onChange={(event) =>
              setEquivalenceId(event.target.value === "" ? "" : Number(event.target.value))
            }
            className="block w-full rounded-md bg-white px-2.5 py-1.5 text-sm text-zinc-900 ring-1 ring-zinc-300 ring-inset"
          >
            <option value="">No equivalence group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-zinc-600">
            Categories and subcategories
          </legend>
          {categories.length === 0 ? (
            <p className="text-sm text-zinc-500">No categories yet. Add them on the Terms page.</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {parents.map((parent) => (
                <li key={parent.id}>
                  <CategoryChoice
                    category={parent}
                    categories={categories}
                    selected={categoryIds}
                    onToggle={toggleCategory}
                  />
                  <ul className="pl-5">
                    {categories
                      .filter((category) => category.parentId === parent.id)
                      .map((child) => (
                        <li key={child.id}>
                          <CategoryChoice
                            category={child}
                            categories={categories}
                            selected={categoryIds}
                            onToggle={toggleCategory}
                          />
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <p className="text-xs leading-5 text-zinc-500">
          Tone tags stay on the places that still match. Tags on wording you remove here are
          deleted. A term can belong to more than one category, and to one equivalence group.
        </p>
        {error ? <Notice tone="red">{error}</Notice> : null}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

function CategoryChoice({
  category,
  categories,
  selected,
  onToggle,
}: {
  category: TermCategory;
  categories: TermCategory[];
  selected: number[];
  onToggle: (id: number) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-zinc-50">
      <input
        type="checkbox"
        className="size-4 rounded border-zinc-300 accent-indigo-600"
        checked={selected.includes(category.id)}
        onChange={() => onToggle(category.id)}
      />
      <span className="text-zinc-900">{categoryLabel(category, categories)}</span>
    </label>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<CommaMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const usesColumns = importUsesColumns(input);
  const effectiveMode = mode ?? guessCommaMode(input);
  const parsed = parseTermList(input, effectiveMode);
  const count = countTermsToImport(parsed);
  const hasCommas = input.includes(",") && !usesColumns;
  const showsLabels = parsed.some((term) => term.categories.length > 0 || term.equivalents.length > 0);

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
          {result.categories.length > 0 ? (
            <p>
              Categories:{" "}
              {result.categories
                .map((category) => `${category.name} (${category.terms.join(", ")})`)
                .join("; ")}
              .
            </p>
          ) : null}
          {result.groups.length > 0 ? (
            <p>
              Equivalence groups:{" "}
              {result.groups
                .map((group) => `${group.name} (${group.terms.join(", ")})`)
                .join("; ")}
              . Those terms stay separate and can be counted together from the Tones page.
            </p>
          ) : null}
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
          <Button variant="primary" busy={busy} disabled={count === 0} onClick={run}>
            Import {count} term{count === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>
            {VARIANT_MEANING} {EQUIVALENCE_MEANING} In the template, separate items in a cell with /.
            The first item under terms is the term and the rest are its variants. An ending such as
            (s) or (es) is read as both the singular and the plural.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => downloadText("term-import-template.csv", TERM_IMPORT_TEMPLATE)}>
              <DownloadIcon /> Download a template
            </Button>
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
        </div>
        <TextArea
          rows={8}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={"terms,categories,equivalents\nwar(s),foreign policy,conflict(s)\npeace,foreign policy / diplomacy,armistice"}
          aria-label="Terms to import"
          className="font-mono"
        />
        {usesColumns ? (
          <p className="text-xs leading-5 text-zinc-500">
            This file uses columns. In terms, the first item is the term and any others are
            variants. Each item in categories is a category for that term, and each item in
            equivalents is a separate term grouped with it.
          </p>
        ) : null}
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
              The first entry on each line is the term; the rest are its variants
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="comma-mode"
                className="accent-indigo-600"
                checked={effectiveMode === "terms"}
                onChange={() => setMode("terms")}
              />
              Every comma-separated entry is a term of its own
            </label>
          </fieldset>
        ) : null}
        {parsed.length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-medium text-zinc-600">
              This will add {count} term{count === 1 ? "" : "s"}
            </p>
            {showsLabels ? (
              <p className="mb-1 text-xs leading-5 text-zinc-500">
                Plain labels are variants, green labels are categories, and indigo labels are
                equivalent terms.
              </p>
            ) : null}
            <ul className="max-h-48 divide-y divide-zinc-100 overflow-y-auto rounded-lg ring-1 ring-zinc-200">
              {parsed.map((term) => (
                <li key={term.text} className="flex flex-wrap items-center gap-1.5 px-3 py-1.5">
                  <span className="font-medium text-zinc-900">{term.text}</span>
                  {term.variants.map((variant) => (
                    <Badge key={`variant-${variant}`}>{variant}</Badge>
                  ))}
                  {term.categories.map((category) => (
                    <Badge key={`category-${category}`} tone="green">
                      {category}
                    </Badge>
                  ))}
                  {term.equivalents.map((equivalent) => (
                    <Badge key={`equivalent-${equivalent}`} tone="indigo">
                      {equivalent}
                    </Badge>
                  ))}
                  {term.equivalence ? <Badge tone="indigo">{term.equivalence}</Badge> : null}
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
