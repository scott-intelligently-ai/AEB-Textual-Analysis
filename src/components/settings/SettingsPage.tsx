"use client";

import { useState } from "react";
import useSWR from "swr";
import { useFeedback } from "@/components/feedback";
import {
  Badge,
  Button,
  Card,
  ErrorBlock,
  LoadingBlock,
  Notice,
  PageHeader,
  TextArea,
  cx,
} from "@/components/ui";
import { fetcher, send } from "@/lib/client/api";
import type { SettingsResponse } from "@/lib/client/types";
import type { Provider, ProviderInfo, Task } from "@/lib/ai/providers";

export function SettingsPage() {
  const settings = useSWR<SettingsResponse>("/api/settings", fetcher);
  if (settings.error) return <ErrorBlock error={settings.error} />;
  if (!settings.data) return <LoadingBlock />;
  return <Settings settings={settings.data} />;
}

function Settings({ settings }: { settings: SettingsResponse }) {
  const { notify, notifyError } = useFeedback();
  const [purposeBase, setPurposeBase] = useState(settings.analysisPurpose);
  const [purpose, setPurpose] = useState(settings.analysisPurpose);
  if (purposeBase !== settings.analysisPurpose) {
    setPurposeBase(settings.analysisPurpose);
    setPurpose(settings.analysisPurpose);
  }
  const [saving, setSaving] = useState(false);

  async function update(patch: Partial<Pick<SettingsResponse, "ocrProvider" | "analysisProvider">>) {
    try {
      await send("PUT", "/api/settings", patch);
    } catch (error) {
      notifyError(error);
    }
  }

  async function savePurpose() {
    setSaving(true);
    try {
      await send("PUT", "/api/settings", { analysisPurpose: purpose });
      notify("Saved.");
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  }

  const missing = settings.providers.filter((provider) => !provider.hasKey);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Choose which provider converts scans and which one looks for overlooked terms. Jev judges tone, and switching providers does not change text already converted or tones already suggested."
      />

      {missing.length > 0 ? (
        <div className="mb-6">
          <Notice tone={missing.length === settings.providers.length ? "red" : "amber"}>
            {missing.length === settings.providers.length
              ? "No AI provider key is set, so converting scans and AI suggestions will not work. "
              : ""}
            Missing: {missing.map((provider) => provider.keyVariable).join(", ")}. Set{" "}
            {missing.length === 1 ? "it" : "them"} in the environment (or a <code>.env.local</code>{" "}
            file) and restart the app.
          </Notice>
        </div>
      ) : null}

      <div className="space-y-6">
        <ProviderChoice
          title="Converting scans to text"
          description="Reads each page image and writes out its text. Accuracy here decides the quality of every count that follows. Word, RTF, and plain text files are read directly."
          task="ocr"
          value={settings.ocrProvider}
          providers={settings.providers}
          onChange={(provider) => update({ ocrProvider: provider })}
        />
        <ProviderChoice
          title="Suggesting terms"
          description="Looks through the documents for terms you may have overlooked. Tone is judged by Jev, not by this provider."
          task="analysis"
          value={settings.analysisProvider}
          providers={settings.providers}
          onChange={(provider) => update({ analysisProvider: provider })}
        />

        <Card className="p-5">
          <label className="block">
            <span className="text-sm font-semibold text-zinc-900">What is this analysis for?</span>
            <span className="mt-1 mb-2 block text-sm leading-6 text-zinc-600">
              Jev is given this description when it judges tone, and the provider above is given it
              when it looks for overlooked terms.
            </span>
            <TextArea rows={4} value={purpose} onChange={(event) => setPurpose(event.target.value)} />
          </label>
          <div className="mt-3">
            <Button
              variant="primary"
              busy={saving}
              disabled={purpose === settings.analysisPurpose}
              onClick={savePurpose}
            >
              Save description
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}

function ProviderChoice({
  title,
  description,
  task,
  value,
  providers,
  onChange,
}: {
  title: string;
  description: string;
  task: Task;
  value: Provider;
  providers: ProviderInfo[];
  onChange: (provider: Provider) => void;
}) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-zinc-600">{description}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={title}>
        {providers.map((info) => {
          const selected = info.provider === value;
          return (
            <label
              key={info.provider}
              className={cx(
                "flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 ring-1 ring-inset",
                selected ? "bg-indigo-50 ring-2 ring-indigo-600" : "bg-white ring-zinc-200 hover:bg-zinc-50",
              )}
            >
              <input
                type="radio"
                name={`provider-${task}`}
                className="mt-1 accent-indigo-600"
                checked={selected}
                onChange={() => onChange(info.provider)}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                  {info.label}
                  {info.hasKey ? (
                    <Badge tone="green">Key set</Badge>
                  ) : (
                    <Badge tone="red">No key</Badge>
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-zinc-600">
                  Model <code className="font-mono text-zinc-800">{info.models[task].id}</code>
                </span>
                <span className="block text-xs leading-5 text-zinc-500">
                  Change it with <code className="font-mono">{info.models[task].variable}</code>
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </Card>
  );
}
