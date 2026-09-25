"use client";

import "./delete-confirm.css";

export function DeleteConfirm({ title, noun, busy, onCancel, onConfirm }: {
  title: string;
  noun: "task" | "assignment";
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <div className="delete-confirm-backdrop" role="presentation"
    onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}>
    <section className="delete-confirm" role="alertdialog" aria-modal="true"
      aria-labelledby="delete-confirm-title" aria-describedby="delete-confirm-detail">
      <p>PERMANENT DELETE</p>
      <h2 id="delete-confirm-title">Delete “{title}” forever?</h2>
      <span id="delete-confirm-detail">This {noun} will be permanently removed. This cannot be undone.</span>
      <div><button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="delete-confirm-action" disabled={busy} onClick={onConfirm}>
          {busy ? "Deleting…" : `Delete ${noun} forever`}</button></div>
    </section>
  </div>;
}
