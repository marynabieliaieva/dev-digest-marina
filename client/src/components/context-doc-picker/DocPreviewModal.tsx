/* DocPreviewModal — read-only preview of one project doc over the current tab.
   `Modal` is portal-free and has no focus handling, so this wrapper adds: initial
   focus inside the dialog, a Tab trap, Esc to close, and focus restoration to the
   element that opened it (the row's Preview button). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown, Modal, Skeleton } from "@devdigest/ui";
import { useContextDoc } from "@/lib/hooks/project-context";
import { s } from "./styles";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function DocPreviewModal({
  repoId,
  path,
  onClose,
}: {
  repoId: string;
  path: string;
  onClose: () => void;
}) {
  const t = useTranslations("contextPicker");
  const doc = useContextDoc(repoId, path);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    rootRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => opener?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !rootRef.current?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div ref={rootRef} onKeyDown={onKeyDown}>
      <Modal title={<span className="mono">{path}</span>} subtitle={t("previewTitle")} onClose={onClose}>
        {doc.isError ? (
          <p role="alert" style={s.modalError}>
            {t("loadError")}
          </p>
        ) : doc.isLoading || !doc.data ? (
          <div style={s.modalBody}>
            <Skeleton height={120} />
          </div>
        ) : (
          <div style={s.modalBody}>
            <Markdown>{doc.data.content}</Markdown>
          </div>
        )}
      </Modal>
    </div>
  );
}
