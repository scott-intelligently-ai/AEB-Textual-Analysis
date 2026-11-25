"use client";

import { useState } from "react";
import useSWR from "swr";
import { useFeedback } from "@/components/feedback";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  ErrorBlock,
  IconButton,
  LoadingBlock,
  Notice,
  PageHeader,
  TextArea,
  TextInput,
} from "@/components/ui";
import { errorMessage, fetcher, send } from "@/lib/client/api";
import type { ToneWithUsage } from "@/lib/client/types";

const COLOR_FIELD =
  "h-8 w-10 cursor-pointer rounded-md border-0 bg-white p-0.5 ring-1 ring-zinc-300 ring-inset";
const DEFINITION_MAX = 500;

export function TonesPage({
  title = "Define tones",
}: {
  /** Page heading. The tone list is opened from the Tones page. */
  title?: string;
} = {}) {
  const { notifyError } = useFeedback();
  const tones = useSWR<ToneWithUsage[]>("/api/tones", fetcher);

  async function move(index: number, delta: -1 | 1) {
    if (!tones.data) return;
    const ids = tones.data.map((tone) => tone.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    try {
      await send("PUT", "/api/tones", { ids });
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <>
      <PageHeader
        title={title}
        description="The tones you can give each use of a term. The colour is used for the term's text in documents. A term that has not been given a tone is shown in the default tone. The score is a number exported with each occurrence, so tone can be averaged in a spreadsheet. A definition says what the tone means; the starting tones leave it blank until you write one."
      />

      {tones.error ? (
        <ErrorBlock error={tones.error} />
      ) : !tones.data ? (
        <LoadingBlock />
      ) : (
        <>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium text-zinc-500">
                <tr>
                  <th className="w-20 px-4 py-2">Order</th>
                  <th className="w-16 px-2 py-2">Colour</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="w-24 px-2 py-2">Score</th>
                  <th className="px-2 py-2">Looks like</th>
                  <th className="px-2 py-2 text-right">In use</th>
                  <th className="px-2 py-2">Default</th>
                  <th className="w-44 px-4 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {tones.data.map((tone, index) => (
                  <ToneRow
                    key={tone.id}
                    tone={tone}
                    shortcut={index + 1}
                    defaultName={tones.data!.find((t) => t.isDefault)?.name ?? "the default tone"}
                    onMove={(delta) => move(index, delta)}
                    first={index === 0}
                    last={index === tones.data!.length - 1}
                  />
                ))}
              </tbody>
            </table>
          </Card>
          <AddTone />
        </>
      )}
    </>
  );
}

function ToneRow({
  tone,
  shortcut,
  defaultName,
  onMove,
  first,
  last,
}: {
  tone: ToneWithUsage;
  shortcut: number;
  defaultName: string;
  onMove: (delta: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const { notify, notifyError, confirm } = useFeedback();
  const saved = {
    name: tone.name,
    color: tone.color,
    score: String(tone.score),
    definition: tone.definition ?? "",
  };
  const [draft, setDraft] = useState(saved);
  const [base, setBase] = useState(saved);
  if (
    base.name !== saved.name ||
    base.color !== saved.color ||
    base.score !== saved.score ||
    base.definition !== saved.definition
  ) {
    setBase(saved);
    setDraft(saved);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const score = Number(draft.score);
  const scoreValid = draft.score.trim() !== "" && Number.isFinite(score);
  const dirty =
    draft.name !== saved.name ||
    draft.color !== saved.color ||
    draft.score !== saved.score ||
    draft.definition !== saved.definition;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await send("PATCH", `/api/tones/${tone.id}`, {
        name: draft.name,
        color: draft.color,
        score,
        definition: draft.definition,
      });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault() {
    try {
      await send("PATCH", `/api/tones/${tone.id}`, { isDefault: true });
      notify(`Terms without a tone are now shown as ${tone.name}.`);
    } catch (cause) {
      notifyError(cause);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete the tone “${tone.name}”?`,
      body:
        tone.usage > 0
          ? `${tone.usage} term occurrence${tone.usage === 1 ? " is" : "s are"} tagged ${tone.name}. ${tone.usage === 1 ? "It" : "They"} will lose that tag and be shown as ${defaultName} again.`
          : "No term occurrences use this tone.",
      confirmLabel: "Delete tone",
      danger: true,
    });
    if (!ok) return;
    try {
      await send("DELETE", `/api/tones/${tone.id}`);
    } catch (cause) {
      notifyError(cause);
    }
  }

  return (
    <>
      <tr>
        <td className="px-4 py-2">
          <div className="flex items-center gap-0.5">
            <span className="w-4 text-xs text-zinc-400 tabular-nums">{shortcut}</span>
            <IconButton label={`Move ${tone.name} up`} disabled={first} onClick={() => onMove(-1)}>
              <ArrowUpIcon />
            </IconButton>
            <IconButton label={`Move ${tone.name} down`} disabled={last} onClick={() => onMove(1)}>
              <ArrowDownIcon />
            </IconButton>
          </div>
        </td>
        <td className="px-2 py-2">
          <input
            type="color"
            value={draft.color}
            onChange={(event) => setDraft({ ...draft, color: event.target.value })}
            aria-label={`Colour of ${tone.name}`}
            className={COLOR_FIELD}
          />
        </td>
        <td className="px-2 py-2">
          <TextInput
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            aria-label={`Name of ${tone.name}`}
          />
        </td>
        <td className="px-2 py-2">
          <TextInput
            type="number"
            step="any"
            value={draft.score}
            onChange={(event) => setDraft({ ...draft, score: event.target.value })}
            aria-label={`Score of ${tone.name}`}
          />
        </td>
        <td className="px-2 py-2">
          <span
            className="term-mark font-serif"
            style={{ "--tone": draft.color, cursor: "default" } as React.CSSProperties}
          >
            freedom
          </span>
        </td>
        <td className="px-2 py-2 text-right text-zinc-600 tabular-nums">
          {tone.usage.toLocaleString()}
        </td>
        <td className="px-2 py-2">
          {tone.isDefault ? (
            <Badge tone="indigo">Default</Badge>
          ) : (
            <Button size="sm" variant="ghost" onClick={makeDefault}>
              Make default
            </Button>
          )}
        </td>
        <td className="px-4 py-2">
          <div className="flex items-center justify-end gap-1">
            {dirty ? (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  busy={busy}
                  disabled={!draft.name.trim() || !scoreValid}
                  onClick={save}
                >
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}>
                  Cancel
                </Button>
              </>
            ) : null}
            <IconButton
              label={
                tone.isDefault
                  ? "The default tone cannot be deleted"
                  : `Delete ${tone.name}`
              }
              disabled={tone.isDefault}
              onClick={remove}
            >
              <TrashIcon />
            </IconButton>
          </div>
        </td>
      </tr>
      <tr>
        <td colSpan={8} className="px-4 pt-0 pb-3">
          <label className="block max-w-3xl">
            <span className="mb-1 block text-xs font-medium text-zinc-600">
              Definition of {tone.name}
            </span>
            <TextArea
              rows={2}
              maxLength={DEFINITION_MAX}
              value={draft.definition}
              onChange={(event) => setDraft({ ...draft, definition: event.target.value })}
              placeholder="What this tone means, so it is chosen the same way each time."
              aria-label={`Definition of ${tone.name}`}
            />
          </label>
        </td>
      </tr>
      {error ? (
        <tr>
          <td colSpan={8} className="px-4 pb-3">
            <Notice tone="red">{error}</Notice>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function AddTone() {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#7c3aed");
  const [score, setScore] = useState("0");
  const [definition, setDefinition] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = Number(score);
  const scoreValid = score.trim() !== "" && Number.isFinite(value);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await send("POST", "/api/tones", { name, color, score: value, definition });
      setName("");
      setDefinition("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6 p-4">
      <h2 className="text-sm font-semibold text-zinc-900">Add a tone</h2>
      <form
        className="mt-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && scoreValid) void add();
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <label>
            <span className="mb-1 block text-xs font-medium text-zinc-600">Colour</span>
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className={COLOR_FIELD}
            />
          </label>
          <label className="min-w-48 flex-1">
            <span className="mb-1 block text-xs font-medium text-zinc-600">Name</span>
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Mixed"
            />
          </label>
          <label className="w-28">
            <span className="mb-1 block text-xs font-medium text-zinc-600">Score</span>
            <TextInput
              type="number"
              step="any"
              value={score}
              onChange={(event) => setScore(event.target.value)}
            />
          </label>
          <Button type="submit" variant="primary" busy={busy} disabled={!name.trim() || !scoreValid}>
            <PlusIcon /> Add tone
          </Button>
        </div>
        <label className="mt-3 block max-w-3xl">
          <span className="mb-1 block text-xs font-medium text-zinc-600">Definition</span>
          <TextArea
            rows={2}
            maxLength={DEFINITION_MAX}
            value={definition}
            onChange={(event) => setDefinition(event.target.value)}
            placeholder="Optional. What this tone means."
            aria-label="Definition of the new tone"
          />
        </label>
      </form>
      {error ? (
        <div className="mt-3">
          <Notice tone="red">{error}</Notice>
        </div>
      ) : null}
    </Card>
  );
}
