"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useFeedback } from "@/components/feedback";
import { AlertIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { Badge, Button, Card, IconButton, Spinner, cx } from "@/components/ui";
import { errorMessage, send } from "@/lib/client/api";
import { uploadWithTicket } from "@/lib/client/storage";
import type { UploadSummary } from "@/lib/client/types";
import { countUncertain } from "@/lib/text/transcription";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.avif";

interface UploadTicket {
  id: number;
  path: string;
  token: string;
}

export function isBusy(upload: UploadSummary): boolean {
  return (
    upload.status === "queued" ||
    upload.status === "rendering" ||
    upload.pages.some((page) => page.ocrStatus === "pending" || page.ocrStatus === "processing")
  );
}

export function UploadDropzone() {
  const { notify } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [failures, setFailures] = useState<{ filename: string; error: string }[]>([]);

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setFailures([]);
    const failed: { filename: string; error: string }[] = [];
    let uploaded = 0;
    for (const file of files) {
      try {
        const ticket = await send<UploadTicket>("POST", "/api/uploads", {
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
        });
        await uploadWithTicket(ticket.path, ticket.token, file);
        await send("POST", `/api/uploads/${ticket.id}/complete`);
        uploaded += 1;
      } catch (error) {
        failed.push({ filename: file.name, error: errorMessage(error) });
      }
    }
    setFailures(failed);
    if (uploaded > 0) {
      notify(
        `Uploaded ${uploaded} file${uploaded === 1 ? "" : "s"}. Converting to text in the background…`,
      );
    }
    setUploading(false);
    if (input.current) input.current.value = "";
  }

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload([...event.dataTransfer.files]);
        }}
        className={cx(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragging ? "border-indigo-500 bg-indigo-50" : "border-zinc-300 bg-white",
        )}
      >
        <UploadIcon className="size-7 text-zinc-400" />
        <div>
          <p className="text-sm font-medium text-zinc-900">
            Drop scanned documents here, or choose files
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            PDF or image (PNG, JPEG, WebP, GIF, TIFF, AVIF). Each page is converted to text by AI.
          </p>
        </div>
        <Button variant="primary" busy={uploading} onClick={() => input.current?.click()}>
          {uploading ? "Uploading…" : "Choose files"}
        </Button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          aria-label="Choose scanned documents to upload"
          onChange={(event) => void upload([...(event.target.files ?? [])])}
        />
      </div>
      {failures.length > 0 ? (
        <ul className="mt-3 space-y-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900 ring-1 ring-red-200 ring-inset">
          {failures.map((failure) => (
            <li key={failure.filename}>{failure.error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function UploadRow({ upload }: { upload: UploadSummary }) {
  const { notify, notifyError, confirm } = useFeedback();
  const [working, setWorking] = useState<"create" | "retry" | null>(null);

  const total = upload.pages.length;
  const done = upload.pages.filter((page) => page.ocrStatus === "done").length;
  const failed = upload.pages.filter((page) => page.ocrStatus === "error").length;
  const busy = isBusy(upload);
  const uncertain = upload.pages.reduce((sum, page) => sum + countUncertain(page.ocrText), 0);
  const preparing = total === 0 && (upload.status === "queued" || upload.status === "rendering");
  const ready = total > 0 && done === total && upload.status === "ready";

  async function createDocument() {
    setWorking("create");
    try {
      await send("POST", `/api/uploads/${upload.id}/document`, {});
      notify(`Created a document from ${upload.filename}.`);
    } catch (error) {
      notifyError(error);
    } finally {
      setWorking(null);
    }
  }

  async function retryFailed() {
    setWorking("retry");
    try {
      await send("POST", `/api/uploads/${upload.id}/ocr`, { failedOnly: true });
    } catch (error) {
      notifyError(error);
    } finally {
      setWorking(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this scan?",
      body: (
        <>
          <strong>{upload.filename}</strong> and its page images will be deleted. Documents already
          created from it keep their text but lose the page images used for checking.
        </>
      ),
      confirmLabel: "Delete scan",
      danger: true,
    });
    if (!ok) return;
    try {
      await send("DELETE", `/api/uploads/${upload.id}`);
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <Card className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-900">{upload.filename}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>
              {total} page{total === 1 ? "" : "s"}
            </span>
            {busy ? (
              <Badge tone="indigo">
                <Spinner className="size-3" />
                {preparing ? "Preparing pages" : `Converting ${done} of ${total}`}
              </Badge>
            ) : upload.status === "error" ? (
              <Badge tone="red">
                <AlertIcon /> {upload.error ?? "This scan could not be prepared."}
              </Badge>
            ) : upload.status === "awaiting_file" ? (
              <Badge tone="amber">Upload did not finish</Badge>
            ) : failed > 0 ? (
              <Badge tone="red">
                <AlertIcon /> {failed} page{failed === 1 ? "" : "s"} failed
              </Badge>
            ) : upload.documents.length > 0 ? (
              <Badge tone="green">Document created</Badge>
            ) : (
              <Badge tone="amber">Ready to review</Badge>
            )}
            {uncertain > 0 ? (
              <Badge tone="amber">
                {uncertain} uncertain reading{uncertain === 1 ? "" : "s"}
              </Badge>
            ) : null}
            {upload.documents.map((document) => (
              <Link
                key={document.id}
                href={`/documents/${document.id}`}
                className="font-medium text-indigo-700 hover:underline"
              >
                {document.title}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {upload.status === "error" && !busy ? (
            <Button
              size="sm"
              busy={working === "retry"}
              onClick={() => {
                setWorking("retry");
                void send("POST", `/api/uploads/${upload.id}/complete`)
                  .catch(notifyError)
                  .finally(() => setWorking(null));
              }}
            >
              Try again
            </Button>
          ) : null}
          {failed > 0 && !busy ? (
            <Button size="sm" busy={working === "retry"} onClick={retryFailed}>
              Retry failed pages
            </Button>
          ) : null}
          {total > 0 ? (
            <Link
              href={`/uploads/${upload.id}`}
              className="inline-flex items-center rounded-md bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 shadow-sm ring-1 ring-zinc-300 ring-inset hover:bg-zinc-50"
            >
              Review pages
            </Link>
          ) : null}
          <Button
            size="sm"
            variant={upload.documents.length === 0 ? "primary" : "secondary"}
            disabled={!ready}
            busy={working === "create"}
            onClick={createDocument}
            title={ready ? undefined : "Available once every page has been converted"}
          >
            {upload.documents.length === 0 ? "Create document" : "Create another"}
          </Button>
          <IconButton label={`Delete ${upload.filename}`} onClick={remove}>
            <TrashIcon />
          </IconButton>
        </div>
      </div>
      {busy && total > 0 ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${Math.round((done / total) * 100)}%` }}
          />
        </div>
      ) : null}
    </Card>
  );
}
