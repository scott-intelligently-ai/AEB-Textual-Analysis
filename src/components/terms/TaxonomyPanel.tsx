"use client";

import { useState } from "react";
import useSWR from "swr";
import { useFeedback } from "@/components/feedback";
import { PencilIcon, PlusIcon, TrashIcon } from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  ErrorBlock,
  IconButton,
  LoadingBlock,
  Modal,
  Notice,
  TextInput,
} from "@/components/ui";
import { errorMessage, fetcher, send } from "@/lib/client/api";
import { categoryPath } from "@/lib/text/categories";
import { EQUIVALENCE_MEANING } from "@/lib/text/explanations";
import type { Term, TermCategory, TermEquivalence } from "@/lib/client/types";

export function categoryLabel(category: TermCategory, categories: TermCategory[]): string {
  return categoryPath(category, categories);
}

export function TaxonomyPanel({ terms }: { terms: Term[] }) {
  const categories = useSWR<TermCategory[]>("/api/term-categories", fetcher);
  const groups = useSWR<TermEquivalence[]>("/api/term-equivalences", fetcher);
  const [editingGroup, setEditingGroup] = useState<TermEquivalence | "new" | null>(null);

  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-zinc-900">Categories</h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          A term can belong to any number of categories and subcategories. A category total also
          includes the terms in its subcategories.
        </p>
        {categories.error ? (
          <div className="mt-3">
            <ErrorBlock error={categories.error} />
          </div>
        ) : !categories.data ? (
          <LoadingBlock />
        ) : (
          <CategoryEditor categories={categories.data} />
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Equivalent terms</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              {EQUIVALENCE_MEANING} A term belongs to at most one group.
            </p>
          </div>
          <Button size="sm" onClick={() => setEditingGroup("new")}>
            <PlusIcon /> New group
          </Button>
        </div>
        {groups.error ? (
          <div className="mt-3">
            <ErrorBlock error={groups.error} />
          </div>
        ) : !groups.data ? (
          <LoadingBlock />
        ) : groups.data.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No equivalence groups yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {groups.data.map((group) => {
              const members = terms.filter((term) => term.equivalenceId === group.id);
              return (
                <li key={group.id} className="flex items-start gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-zinc-900">{group.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {members.length === 0 ? (
                        <span className="text-xs text-zinc-400">No terms yet</span>
                      ) : (
                        members.map((term) => <Badge key={term.id}>{term.text}</Badge>)
                      )}
                    </div>
                  </div>
                  <IconButton label={`Edit ${group.name}`} onClick={() => setEditingGroup(group)}>
                    <PencilIcon />
                  </IconButton>
                  <DeleteGroupButton group={group} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {editingGroup ? (
        <EquivalenceDialog
          group={editingGroup === "new" ? null : editingGroup}
          terms={terms}
          groups={groups.data ?? []}
          onClose={() => setEditingGroup(null)}
        />
      ) : null}
    </div>
  );
}

function CategoryEditor({ categories }: { categories: TermCategory[] }) {
  const { notify, notifyError, confirm } = useFeedback();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<TermCategory | null>(null);
  const parents = categories.filter((category) => category.parentId === null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await send("POST", "/api/term-categories", {
        name,
        parentId: parentId === "" ? null : parentId,
      });
      setName("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(category: TermCategory) {
    const children = categories.filter((item) => item.parentId === category.id);
    const ok = await confirm({
      title: `Delete “${category.name}”?`,
      body:
        children.length > 0
          ? `Its ${children.length} subcategor${children.length === 1 ? "y" : "ies"} will be deleted too. Terms stay on the list.`
          : "Terms assigned to it stay on the list.",
      confirmLabel: "Delete category",
      danger: true,
    });
    if (!ok) return;
    try {
      await send("DELETE", `/api/term-categories/${category.id}`);
      notify(`Deleted “${category.name}”.`);
    } catch (cause) {
      notifyError(cause);
    }
  }

  return (
    <>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void add();
        }}
      >
        <label className="min-w-36 flex-1">
          <span className="mb-1 block text-xs font-medium text-zinc-600">Name</span>
          <TextInput value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="min-w-36 flex-1">
          <span className="mb-1 block text-xs font-medium text-zinc-600">Place under</span>
          <select
            value={parentId}
            onChange={(event) =>
              setParentId(event.target.value === "" ? "" : Number(event.target.value))
            }
            className="block w-full rounded-md bg-white px-2.5 py-1.5 text-sm text-zinc-900 ring-1 ring-zinc-300 ring-inset"
          >
            <option value="">Top-level category</option>
            {parents.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" busy={busy} disabled={!name.trim()}>
          <PlusIcon /> Add
        </Button>
      </form>
      {error ? (
        <div className="mt-2">
          <Notice tone="red">{error}</Notice>
        </div>
      ) : null}
      {categories.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No categories yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-100">
          {parents.map((parent) => (
            <li key={parent.id} className="py-2">
              <CategoryRow category={parent} onRename={setRenaming} onDelete={remove} />
              <ul>
                {categories
                  .filter((category) => category.parentId === parent.id)
                  .map((child) => (
                    <li key={child.id} className="pl-4">
                      <CategoryRow category={child} onRename={setRenaming} onDelete={remove} />
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {renaming ? <RenameCategoryDialog category={renaming} onClose={() => setRenaming(null)} /> : null}
    </>
  );
}

function CategoryRow({
  category,
  onRename,
  onDelete,
}: {
  category: TermCategory;
  onRename: (category: TermCategory) => void;
  onDelete: (category: TermCategory) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-900">{category.name}</span>
      <IconButton label={`Rename ${category.name}`} onClick={() => onRename(category)}>
        <PencilIcon />
      </IconButton>
      <IconButton label={`Delete ${category.name}`} onClick={() => onDelete(category)}>
        <TrashIcon />
      </IconButton>
    </div>
  );
}

function RenameCategoryDialog({
  category,
  onClose,
}: {
  category: TermCategory;
  onClose: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await send("PATCH", `/api/term-categories/${category.id}`, { name });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Rename category"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!name.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void save();
        }}
      >
        <TextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-label="Category name" />
        {error ? (
          <div className="mt-3">
            <Notice tone="red">{error}</Notice>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

function DeleteGroupButton({ group }: { group: TermEquivalence }) {
  const { notify, notifyError, confirm } = useFeedback();

  async function remove() {
    const ok = await confirm({
      title: `Delete “${group.name}”?`,
      body: "The terms stay on the list. They are just no longer counted together.",
      confirmLabel: "Delete group",
      danger: true,
    });
    if (!ok) return;
    try {
      await send("DELETE", `/api/term-equivalences/${group.id}`);
      notify(`Deleted “${group.name}”.`);
    } catch (cause) {
      notifyError(cause);
    }
  }

  return (
    <IconButton label={`Delete ${group.name}`} onClick={remove}>
      <TrashIcon />
    </IconButton>
  );
}

function EquivalenceDialog({
  group,
  terms,
  groups,
  onClose,
}: {
  group: TermEquivalence | null;
  terms: Term[];
  groups: TermEquivalence[];
  onClose: () => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [termIds, setTermIds] = useState<number[]>(
    group ? terms.filter((term) => term.equivalenceId === group.id).map((term) => term.id) : [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = new Map(groups.map((item) => [item.id, item.name]));

  function toggle(id: number) {
    setTermIds((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (group) await send("PATCH", `/api/term-equivalences/${group.id}`, { name, termIds });
      else await send("POST", "/api/term-equivalences", { name, termIds });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={group ? "Edit equivalence group" : "New equivalence group"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!name.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">Name</span>
          <TextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-zinc-600">Terms counted together</legend>
          {terms.length === 0 ? (
            <p className="text-sm text-zinc-500">Add terms first, then assign them here.</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {terms.map((term) => {
                const elsewhere =
                  term.equivalenceId !== null && term.equivalenceId !== group?.id
                    ? names.get(term.equivalenceId)
                    : undefined;
                return (
                  <li key={term.id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-zinc-50">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 rounded border-zinc-300 accent-indigo-600"
                        checked={termIds.includes(term.id)}
                        onChange={() => toggle(term.id)}
                      />
                      <span>
                        <span className="text-zinc-900">{term.text}</span>
                        {elsewhere ? (
                          <span className="ml-2 text-xs text-zinc-500">currently in {elsewhere}</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
        <p className="text-xs leading-5 text-zinc-500">
          Choosing a term that is already in another group moves it into this one.
        </p>
        {error ? <Notice tone="red">{error}</Notice> : null}
      </div>
    </Modal>
  );
}
