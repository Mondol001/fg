import React, { useEffect, useMemo, useRef, useState } from "react";
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import {
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyD2VUTPioN2WyWfVLML1YxQho6NL4rkc5I",
  authDomain: "my-app-a5b52.firebaseapp.com",
  projectId: "my-app-a5b52",
  storageBucket: "my-app-a5b52.firebasestorage.app",
  messagingSenderId: "213828908146",
  appId: "1:213828908146:web:3a4bca5a8393a7151d3eeb",
  measurementId: "G-RX02N4FEEH",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const USERS_COLLECTION = "users";
const DAY_MS = 24 * 60 * 60 * 1000;
const EDITABLE_FIELDS = ["uid", "name", "fromDate", "validity", "toDate", "payment", "remarks"];
const VALIDITY_OPTIONS = [
  { label: "2 hours", value: 2, unit: "hours" },
  { label: "1 day", value: 1, unit: "days" },
  { label: "3 days", value: 3, unit: "days" },
  { label: "7 days", value: 7, unit: "days" },
  { label: "10 days", value: 10, unit: "days" },
  { label: "15 days", value: 15, unit: "days" },
  { label: "30 days", value: 30, unit: "days" },
];

const pad = (n) => String(n).padStart(2, "0");

function nowLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function coerceDate(value) {
  if (!value) return null;
  if (typeof value === "object" && typeof value.toDate === "function") return value.toDate();
  if (typeof value === "object" && typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateToLocalInput(value) {
  const d = coerceDate(value);
  if (!d) return nowLocal();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDisplay(value) {
  const d = coerceDate(value);
  if (!d) return "";
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addValidity(fromDate, validity) {
  const d = coerceDate(fromDate);
  if (!d) return nowLocal();
  const copy = new Date(d);
  if (validity?.unit === "hours") copy.setHours(copy.getHours() + Number(validity.value || 0));
  else copy.setDate(copy.getDate() + Number(validity?.value || 0));
  return dateToLocalInput(copy);
}

function getRemainingMs(toDate, nowMs = Date.now()) {
  const d = coerceDate(toDate);
  return d ? d.getTime() - nowMs : null;
}

function daysLeft(toDate, nowMs = Date.now()) {
  const remaining = getRemainingMs(toDate, nowMs);
  return remaining === null ? null : Math.ceil(remaining / DAY_MS);
}

function isExpired(toDate, nowMs = Date.now()) {
  const remaining = getRemainingMs(toDate, nowMs);
  return remaining !== null && remaining < 0;
}

function getStatus(toDate, nowMs = Date.now()) {
  const remaining = getRemainingMs(toDate, nowMs);
  if (remaining === null) return "Unknown";
  if (remaining < 0) return "Expired";
  if (remaining <= 7 * DAY_MS) return "Ending Soon";
  return "Active";
}

function timeLeftLabel(toDate, nowMs = Date.now()) {
  const remaining = getRemainingMs(toDate, nowMs);
  if (remaining === null) return "Unknown";
  if (remaining < 0) return `Expired ${Math.abs(daysLeft(toDate, nowMs) || 0)}d ago`;
  const mins = Math.floor(remaining / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

function validityLabel(v) {
  if (!v || typeof v !== "object") return "";
  return `${v.value} ${v.unit}`;
}

function paymentIsPending(payment) {
  const p = String(payment ?? "").trim();
  return !p || p === "0";
}

function paymentLabel(payment) {
  return paymentIsPending(payment) ? "Payment Pending" : String(payment).trim();
}

function monthKey(value) {
  const d = coerceDate(value);
  if (!d) return "unknown";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function monthLabel(value) {
  const d = coerceDate(value);
  if (!d) return "Unknown Month";
  return d.toLocaleString("default", { month: "long", year: "numeric" });
}

function blankForm() {
  const start = nowLocal();
  const validity = VALIDITY_OPTIONS[1];
  return {
    uid: "",
    name: "",
    fromDate: start,
    validity,
    toDate: addValidity(start, validity),
    payment: "",
    remarks: "",
    editFields: [],
  };
}

function normalizeDoc(id, data = {}) {
  return {
    id,
    uid: data.uid ?? "",
    name: data.name ?? "",
    fromDate: dateToLocalInput(data.fromDate),
    validity: data.validity && typeof data.validity === "object" ? data.validity : VALIDITY_OPTIONS[1],
    toDate: dateToLocalInput(data.toDate),
    payment: data.payment ?? "",
    remarks: data.remarks ?? "",
    records: Array.isArray(data.records) ? data.records : [],
  };
}

function sanitizeForFirestore(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map((v) => sanitizeForFirestore(v));
  if (typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
      const s = sanitizeForFirestore(v);
      if (s !== undefined) out[k] = s;
    });
    return out;
  }
  return value;
}

function normalizeCompare(field, value) {
  if (field === "validity") return validityLabel(value) || "";
  if (field === "fromDate" || field === "toDate") return dateToLocalInput(value);
  if (field === "payment") return paymentIsPending(value) ? "PENDING" : String(value ?? "").trim();
  return String(value ?? "").trim();
}

function getChangedFields(curr, prev = {}) {
  return EDITABLE_FIELDS.filter((field) => normalizeCompare(field, curr?.[field]) !== normalizeCompare(field, prev?.[field]));
}

function getChangesObject(curr, prev = {}) {
  const changes = {};
  getChangedFields(curr, prev).forEach((field) => {
    changes[field] = { from: sanitizeForFirestore(prev?.[field]), to: sanitizeForFirestore(curr?.[field]) };
  });
  return changes;
}

function makeHistoryRecord(action, previous, next, note = "") {
  const savedAt = new Date().toISOString();
  const changes = getChangesObject(next, previous || {});
  return sanitizeForFirestore({
    action,
    note,
    savedAt,
    month: monthKey(savedAt),
    monthName: monthLabel(savedAt),
    uid: next?.uid || "",
    name: next?.name || "",
    fromDate: next?.fromDate || "",
    validity: next?.validity || VALIDITY_OPTIONS[1],
    toDate: next?.toDate || "",
    payment: next?.payment || "",
    remarks: next?.remarks || "",
    changes,
    changedFields: Object.keys(changes),
  });
}

function toFirestorePayload(user) {
  const records = Array.isArray(user?.records) ? user.records : [];
  return sanitizeForFirestore({
    uid: String(user?.uid || ""),
    name: String(user?.name || ""),
    fromDate: String(user?.fromDate || ""),
    validity: { value: Number(user?.validity?.value || 1), unit: String(user?.validity?.unit || "days") },
    toDate: String(user?.toDate || ""),
    payment: String(user?.payment || ""),
    remarks: String(user?.remarks || ""),
    records: records.map((r) => ({
      action: String(r?.action || ""),
      note: String(r?.note || ""),
      savedAt: String(r?.savedAt || new Date().toISOString()),
      month: String(r?.month || "unknown"),
      monthName: String(r?.monthName || "Unknown Month"),
      uid: String(r?.uid || ""),
      name: String(r?.name || ""),
      fromDate: String(r?.fromDate || ""),
      validity: { value: Number(r?.validity?.value || 1), unit: String(r?.validity?.unit || "days") },
      toDate: String(r?.toDate || ""),
      payment: String(r?.payment || ""),
      remarks: String(r?.remarks || ""),
      changes: sanitizeForFirestore(r?.changes && typeof r.changes === "object" ? r.changes : {}),
      changedFields: Array.isArray(r?.changedFields) ? r.changedFields : [],
    })),
    createdAt: user?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

function csvEscape(value) {
  const s = String(value ?? "");
  return `"${s.replaceAll('"', '""')}"`;
}

function usersToCsv(users) {
  const header = ["UID", "Name", "From Date", "Validity", "To Date", "Remaining", "Status", "Payment", "Remarks"];
  const rows = users.map((u) => [
    u.uid,
    u.name,
    formatDisplay(u.fromDate),
    validityLabel(u.validity),
    formatDisplay(u.toDate),
    timeLeftLabel(u.toDate),
    getStatus(u.toDate),
    paymentLabel(u.payment),
    u.remarks || "",
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildReceiptHtml(user) {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>Receipt - ${String(user.name || "")}</title><style>
    body{font-family:Arial,sans-serif;margin:0;padding:24px;background:#f5f7fb;color:#111827}
    .card{max-width:700px;margin:0 auto;background:white;border:1px solid #d1d5db;border-radius:16px;padding:24px}
    h1{margin:0 0 6px;font-size:24px}
    .sub{color:#6b7280;margin-bottom:18px;font-size:14px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .item{border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;background:#fafafa}
    .label{font-size:12px;color:#6b7280;margin-bottom:6px}
    .value{font-size:15px;font-weight:600;color:#111827;word-break:break-word}
    .full{grid-column:1 / -1}
    .footer{margin-top:18px;font-size:12px;color:#6b7280;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
    @media print{body{background:white;padding:0}.card{border:none;border-radius:0}}
  </style></head><body><div class="card"><h1>WiFi Receipt</h1><div class="sub">Generated at ${new Date().toLocaleString()}</div><div class="grid"><div class="item"><div class="label">UID</div><div class="value">${String(user.uid || "")}</div></div><div class="item"><div class="label">Name</div><div class="value">${String(user.name || "")}</div></div><div class="item"><div class="label">From Date</div><div class="value">${formatDisplay(user.fromDate)}</div></div><div class="item"><div class="label">To Date</div><div class="value">${formatDisplay(user.toDate)}</div></div><div class="item"><div class="label">Validity</div><div class="value">${validityLabel(user.validity)}</div></div><div class="item"><div class="label">Status</div><div class="value">${getStatus(user.toDate)}</div></div><div class="item full"><div class="label">Remaining</div><div class="value">${timeLeftLabel(user.toDate)}</div></div><div class="item full"><div class="label">Payment</div><div class="value">${paymentLabel(user.payment)}</div></div><div class="item full"><div class="label">Remarks</div><div class="value">${String(user.remarks || "-")}</div></div></div><div class="footer"><div>Thank you</div><div>WiFi User Management</div></div></div><script>setTimeout(() => window.print(), 250);</script></body></html>`;
}

function printReceipt(user) {
  const win = window.open("", "_blank", "width=900,height=900");
  if (!win) return alert("Popup blocked. Please allow popups for printing.");
  win.document.open();
  win.document.write(buildReceiptHtml(user));
  win.document.close();
  win.focus();
}

function playBeep(kind = "soon") {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") ctx.resume();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = 0.08;
    const tone = (freq, start, dur) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    if (kind === "expired") {
      tone(880, 0, 0.18);
      tone(660, 0.22, 0.18);
    } else {
      tone(740, 0, 0.16);
      tone(740, 0.22, 0.16);
    }
    setTimeout(() => ctx.close?.(), 1000);
  } catch (e) {
    console.error(e);
  }
}

function StatCard({ title, value, subtitle }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
      <div className="text-sm text-slate-400">{title}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
      {subtitle ? <div className="mt-1 text-sm text-slate-500">{subtitle}</div> : null}
    </div>
  );
}

function TabButton({ active, children, onClick }) {
  return (
    <button onClick={onClick} className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${active ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"}`}>
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="space-y-2">
      <div className="text-sm text-slate-300">{label}</div>
      {children}
    </label>
  );
}

function Modal({ title, onClose, children, width = "max-w-3xl" }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 py-6">
      <div className={`w-full ${width} max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-800 bg-slate-950 p-5 shadow-2xl`}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xl font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="rounded-2xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function UserForm({ title, form, setForm, onSave, onClose, saveLabel, mode }) {
  const changeFromDate = (value) => setForm((prev) => ({ ...prev, fromDate: value, toDate: addValidity(value, prev.validity) }));
  const changeValidity = (valueStr) => {
    const [value, unit] = valueStr.split("|");
    const validity = { value: Number(value), unit };
    setForm((prev) => ({ ...prev, validity, toDate: addValidity(prev.fromDate, validity) }));
  };
  const toggleField = (field, checked) => {
    setForm((prev) => {
      const current = new Set(prev.editFields || []);
      if (checked) current.add(field);
      else current.delete(field);
      return { ...prev, editFields: [...current] };
    });
  };
  const isEditable = (field) => mode !== "edit" || (form.editFields || []).includes(field);

  return (
    <Modal title={title} onClose={onClose} width="max-w-4xl">
      {mode === "edit" ? (
        <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-950 p-4">
          <div className="mb-3 text-sm font-medium text-slate-200">Select fields to edit</div>
          <div className="grid gap-2 md:grid-cols-3">
            {EDITABLE_FIELDS.map((field) => (
              <label key={field} className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200">
                <input type="checkbox" checked={(form.editFields || []).includes(field)} onChange={(e) => toggleField(field, e.target.checked)} className="h-4 w-4 accent-indigo-500" />
                <span>{field}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {isEditable("uid") ? <Field label="User ID / UID"><input value={form.uid} onChange={(e) => setForm((p) => ({ ...p, uid: e.target.value }))} className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 outline-none" /></Field> : null}
        {isEditable("name") ? <Field label="Name"><input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 outline-none" /></Field> : null}
        {isEditable("validity") ? <Field label="Validity"><select value={`${form.validity.value}|${form.validity.unit}`} onChange={(e) => changeValidity(e.target.value)} className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 outline-none">{VALIDITY_OPTIONS.map((opt) => <option key={`${opt.value}-${opt.unit}`} value={`${opt.value}|${opt.unit}`}>{opt.label}</option>)}</select></Field> : null}
        {isEditable("fromDate") ? <Field label="From Date and Time"><input type="datetime-local" value={form.fromDate} onChange={(e) => changeFromDate(e.target.value)} className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 outline-none" /></Field> : null}
        {isEditable("toDate") ? <Field label="To Date and Time"><input type="datetime-local" value={form.toDate} onChange={(e) => setForm((p) => ({ ...p, toDate: e.target.value }))} className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 outline-none" /></Field> : null}
        {isEditable("payment") ? <Field label="Payment Amount"><input value={form.payment} onChange={(e) => setForm((p) => ({ ...p, payment: e.target.value }))} placeholder="leave blank or 0 for pending" className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 outline-none" /></Field> : null}
        {isEditable("remarks") ? <Field label="Remarks"><input value={form.remarks} onChange={(e) => setForm((p) => ({ ...p, remarks: e.target.value }))} className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 outline-none" /></Field> : null}
      </div>

      {mode === "edit" ? <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-300">Only the selected fields will be saved. Other fields remain unchanged.</div> : null}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-2xl border border-slate-700 px-4 py-2 text-slate-100 hover:bg-slate-900">Cancel</button>
        <button onClick={onSave} className="rounded-2xl bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-600">{saveLabel}</button>
      </div>
    </Modal>
  );
}

function HistoryModal({ user, onClose, onCopy }) {
  const history = Array.isArray(user.records) ? user.records : [];
  return (
    <Modal title={`History: ${user.name}`} onClose={onClose} width="max-w-6xl">
      <div className="mt-4 space-y-4">
        <div className="rounded-3xl border border-slate-800 bg-slate-950 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-white">Current profile</div>
            <div className="flex gap-2">
              <button onClick={() => onCopy?.(user.uid)} className="rounded-2xl border border-slate-700 px-3 py-2 text-xs text-slate-100 hover:bg-slate-900">Copy UID</button>
              <button onClick={() => navigator.clipboard.writeText(JSON.stringify(user, null, 2)).then(() => alert("Profile copied")).catch(() => alert("Copy failed"))} className="rounded-2xl border border-slate-700 px-3 py-2 text-xs text-slate-100 hover:bg-slate-900">Copy Profile</button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3"><div className="text-xs text-slate-400">UID</div><div className="mt-1 text-slate-100">{user.uid}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3"><div className="text-xs text-slate-400">Name</div><div className="mt-1 text-slate-100">{user.name}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3"><div className="text-xs text-slate-400">From Date</div><div className="mt-1 text-slate-100">{formatDisplay(user.fromDate)}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3"><div className="text-xs text-slate-400">To Date</div><div className="mt-1 text-slate-100">{formatDisplay(user.toDate)}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3"><div className="text-xs text-slate-400">Validity</div><div className="mt-1 text-slate-100">{validityLabel(user.validity)}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3"><div className="text-xs text-slate-400">Payment</div><div className="mt-1 text-slate-100">{paymentLabel(user.payment)}</div></div>
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-950">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-900 text-slate-300">
                <tr>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Saved At</th>
                  <th className="px-4 py-3 font-medium">Month</th>
                  <th className="px-4 py-3 font-medium">UID</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">From Date</th>
                  <th className="px-4 py-3 font-medium">Validity</th>
                  <th className="px-4 py-3 font-medium">To Date</th>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {history.length ? history.map((item, idx) => (
                  <tr key={`${item.savedAt || idx}`} className="border-t border-slate-800 hover:bg-slate-900/70">
                    <td className="px-4 py-3 text-slate-300">{item.action || "record"}</td>
                    <td className="px-4 py-3 text-slate-300">{formatDisplay(item.savedAt)}</td>
                    <td className="px-4 py-3 text-slate-300">{item.monthName || monthLabel(item.savedAt)}</td>
                    <td className="px-4 py-3 text-slate-300">{item.uid || "-"}</td>
                    <td className="px-4 py-3 text-slate-300">{item.name || "-"}</td>
                    <td className="px-4 py-3 text-slate-300">{formatDisplay(item.fromDate)}</td>
                    <td className="px-4 py-3 text-slate-300">{validityLabel(item.validity)}</td>
                    <td className="px-4 py-3 text-slate-300">{formatDisplay(item.toDate)}</td>
                    <td className="px-4 py-3 text-slate-300">{paymentLabel(item.payment)}</td>
                    <td className="px-4 py-3 text-slate-300">{item.remarks || "-"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400">No record found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ReceiptModal({ user, onClose, onPrint }) {
  return (
    <Modal title="Print Receipt" onClose={onClose} width="max-w-3xl">
      <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-950 p-5">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="text-xl font-bold text-white">WiFi Receipt</div>
          <div className="mt-1 text-sm text-slate-400">Generated at {new Date().toLocaleString()}</div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3"><div className="text-xs text-slate-400">UID</div><div className="mt-1 text-white">{user.uid}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3"><div className="text-xs text-slate-400">Name</div><div className="mt-1 text-white">{user.name}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3"><div className="text-xs text-slate-400">From Date</div><div className="mt-1 text-white">{formatDisplay(user.fromDate)}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3"><div className="text-xs text-slate-400">To Date</div><div className="mt-1 text-white">{formatDisplay(user.toDate)}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3"><div className="text-xs text-slate-400">Validity</div><div className="mt-1 text-white">{validityLabel(user.validity)}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3"><div className="text-xs text-slate-400">Status</div><div className="mt-1 text-white">{getStatus(user.toDate)}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 md:col-span-2"><div className="text-xs text-slate-400">Remaining</div><div className="mt-1 text-white">{timeLeftLabel(user.toDate)}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 md:col-span-2"><div className="text-xs text-slate-400">Payment</div><div className="mt-1 text-white">{paymentLabel(user.payment)}</div></div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 md:col-span-2"><div className="text-xs text-slate-400">Remarks</div><div className="mt-1 text-white">{user.remarks || "-"}</div></div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-2xl border border-slate-700 px-4 py-2 text-slate-100 hover:bg-slate-900">Close</button>
          <button onClick={() => onPrint(user)} className="rounded-2xl bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-600">Print Receipt</button>
        </div>
      </div>
    </Modal>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return <div className="fixed bottom-4 right-4 z-[60] rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white shadow-2xl">{toast}</div>;
}

function Table({ users, nowMs, onEdit, onRenew, onHistory, onDelete, onCopyUid, onPrintReceipt, selectedIds, onToggleSelected, onToggleSelectAll, emptyText }) {
  const selectAllRef = useRef(null);
  const allSelected = users.length > 0 && users.every((u) => selectedIds.has(u.id));
  const someSelected = users.some((u) => selectedIds.has(u.id));

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-950">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-300">
            <tr>
              <th className="px-3 py-3 font-medium">
                <input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={(e) => onToggleSelectAll(users, e.target.checked)} className="h-4 w-4 accent-indigo-500" />
              </th>
              <th className="px-4 py-3 font-medium">UID</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">From Date</th>
              <th className="px-4 py-3 font-medium">Validity</th>
              <th className="px-4 py-3 font-medium">To Date</th>
              <th className="px-4 py-3 font-medium">Remaining</th>
              <th className="px-4 py-3 font-medium">Payment</th>
              <th className="px-4 py-3 font-medium">Remarks</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {users.length ? users.map((u) => {
              const status = getStatus(u.toDate, nowMs);
              return (
                <tr key={u.id} className={`border-t border-slate-800 hover:bg-slate-900/70 ${status === "Expired" ? "bg-rose-500/5" : status === "Ending Soon" ? "bg-amber-500/5" : ""}`}>
                  <td className="px-3 py-3 align-top">
                    <input type="checkbox" checked={selectedIds.has(u.id)} onChange={(e) => onToggleSelected(u.id, e.target.checked)} className="h-4 w-4 accent-indigo-500" />
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{u.uid}</span>
                      <button onClick={() => onCopyUid?.(u.uid)} className="rounded-full border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-900">Copy</button>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-white">{u.name}</td>
                  <td className="px-4 py-3 text-slate-300">{formatDisplay(u.fromDate)}</td>
                  <td className="px-4 py-3 text-slate-300">{validityLabel(u.validity)}</td>
                  <td className="px-4 py-3 text-slate-300">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{formatDisplay(u.toDate)}</span>
                      <span className={`rounded-full border px-2 py-1 text-xs ${status === "Expired" ? "bg-rose-500/20 text-rose-200 border-rose-500/30" : status === "Ending Soon" ? "bg-amber-500/20 text-amber-200 border-amber-500/30" : "bg-emerald-500/20 text-emerald-200 border-emerald-500/30"}`}>{status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{timeLeftLabel(u.toDate, nowMs)}</td>
                  <td className="px-4 py-3 text-slate-300">{paymentLabel(u.payment)}</td>
                  <td className="px-4 py-3 text-slate-300">{u.remarks || "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => onEdit(u)} className="rounded-2xl border border-slate-700 px-3 py-2 text-xs text-slate-100 hover:bg-slate-900">Edit</button>
                      {isExpired(u.toDate, nowMs) ? <button onClick={() => onRenew(u)} className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs text-white hover:bg-emerald-700">Renew</button> : null}
                      <button onClick={() => onHistory(u)} className="rounded-2xl bg-slate-700 px-3 py-2 text-xs text-white hover:bg-slate-600">History</button>
                      <button onClick={() => onPrintReceipt(u)} className="rounded-2xl bg-indigo-500 px-3 py-2 text-xs text-white hover:bg-indigo-600">Receipt</button>
                      <button onClick={() => onDelete(u)} className="rounded-2xl bg-rose-500 px-3 py-2 text-xs text-white hover:bg-rose-600">Delete</button>
                    </div>
                  </td>
                </tr>
              );
            }) : (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400">{emptyText}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuthScreen({ onLogin, loading, onReset }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <h1 className="text-2xl font-bold">Firebase Login</h1>
        <p className="mt-1 text-sm text-slate-400">Sign in to manage your WiFi users.</p>
        <div className="mt-5 space-y-4">
          <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none" /></Field>
          <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none" /></Field>
          <button disabled={loading} onClick={() => onLogin(email, password)} className="w-full rounded-2xl bg-emerald-600 px-4 py-3 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{loading ? "Please wait..." : "Login"}</button>
          <button onClick={() => onReset(email)} className="w-full rounded-2xl border border-slate-700 px-4 py-3 text-slate-100 hover:bg-slate-800">Forgot password</button>
        </div>
      </div>
    </div>
  );
}

function sortUsers(list, sortMode, nowMs) {
  const arr = [...list];
  arr.sort((a, b) => {
    if (sortMode === "name-asc") return String(a.name || "").localeCompare(String(b.name || ""));
    if (sortMode === "name-desc") return String(b.name || "").localeCompare(String(a.name || ""));
    if (sortMode === "expiry-asc") return (getRemainingMs(a.toDate, nowMs) ?? 999999999) - (getRemainingMs(b.toDate, nowMs) ?? 999999999);
    if (sortMode === "expiry-desc") return (getRemainingMs(b.toDate, nowMs) ?? 999999999) - (getRemainingMs(a.toDate, nowMs) ?? 999999999);
    return 0;
  });
  return arr;
}

export default function WifiUserManagementDashboard() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [sortMode, setSortMode] = useState("expiry-asc");
  const [noticeIndex, setNoticeIndex] = useState(0);
  const [form, setForm] = useState(blankForm());
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [historyUser, setHistoryUser] = useState(null);
  const [receiptUser, setReceiptUser] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editingDocId, setEditingDocId] = useState(null);
  const [modalMode, setModalMode] = useState("add");
  const [currentUser, setCurrentUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [toast, setToast] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const toastRef = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 1800);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user || null);
      setLoadingAuth(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    setBusy(true);
    const unsub = onSnapshot(
      query(collection(db, USERS_COLLECTION), orderBy("updatedAt", "desc")),
      (snap) => {
        setUsers(snap.docs.map((d) => normalizeDoc(d.id, d.data())));
        setBusy(false);
      },
      (error) => {
        console.error(error);
        alert(`Load failed: ${error.message}`);
        setBusy(false);
      }
    );
    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const keep = new Set();
      prev.forEach((id) => {
        if (users.some((u) => u.id === id)) keep.add(id);
      });
      return keep;
    });
  }, [users]);

  const endingSoonUsers = useMemo(
    () =>
      users
        .filter((u) => {
          const remaining = getRemainingMs(u.toDate, nowTick);
          return remaining !== null && remaining >= 0 && remaining <= 7 * DAY_MS;
        })
        .sort((a, b) => (getRemainingMs(a.toDate, nowTick) ?? 999999) - (getRemainingMs(b.toDate, nowTick) ?? 999999)),
    [users, nowTick]
  );

  useEffect(() => {
    if (!endingSoonUsers.length) return;
    setNoticeIndex(0);
    const timer = setInterval(() => setNoticeIndex((p) => (p + 1) % endingSoonUsers.length), 3500);
    return () => clearInterval(timer);
  }, [endingSoonUsers.length]);

  const totalUsers = users.length;
  const expiredUsers = users.filter((u) => isExpired(u.toDate, nowTick)).length;
  const pendingUsers = users.filter((u) => paymentIsPending(u.payment)).length;
  const totalCollected = users.reduce((sum, u) => {
    const n = Number(String(u.payment ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) && n > 0 ? sum + n : sum;
  }, 0);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = users.filter((u) =>
      [u.uid, u.name, u.fromDate, validityLabel(u.validity), u.toDate, timeLeftLabel(u.toDate, nowTick), paymentLabel(u.payment), u.remarks, getStatus(u.toDate, nowTick)]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
    return sortUsers(matched, sortMode, nowTick);
  }, [users, search, sortMode, nowTick]);

  const activeUsers = filteredUsers.filter((u) => !isExpired(u.toDate, nowTick));
  const pendingPaymentUsers = filteredUsers.filter((u) => paymentIsPending(u.payment));
  const expiredList = filteredUsers.filter((u) => isExpired(u.toDate, nowTick));

  const resetForm = () => setForm(blankForm());

  const openAdd = () => {
    setEditingDocId(null);
    setModalMode("add");
    resetForm();
    setUserModalOpen(true);
  };

  const startEdit = (user) => {
    setEditingDocId(user.id);
    setModalMode("edit");
    setForm({
      uid: user.uid || "",
      name: user.name || "",
      fromDate: dateToLocalInput(user.fromDate),
      validity: user.validity || VALIDITY_OPTIONS[1],
      toDate: dateToLocalInput(user.toDate),
      payment: paymentIsPending(user.payment) ? "" : String(user.payment ?? ""),
      remarks: user.remarks || "",
      editFields: [],
    });
    setUserModalOpen(true);
  };

  const startRenew = (user) => {
    setEditingDocId(user.id);
    setModalMode("renew");
    const base = nowLocal();
    const validity = user.validity || VALIDITY_OPTIONS[1];
    setForm({
      uid: user.uid || "",
      name: user.name || "",
      fromDate: base,
      validity,
      toDate: addValidity(base, validity),
      payment: user.payment || "",
      remarks: user.remarks || "",
      editFields: [],
    });
    setUserModalOpen(true);
  };

  const saveUser = async () => {
    try {
      const uid = String(form.uid || "").trim();
      const name = String(form.name || "").trim();
      if (!uid || !name) return showToast("UID and Name required");

      const payload = {
        uid,
        name,
        fromDate: String(form.fromDate || nowLocal()),
        validity: { value: Number(form?.validity?.value || 1), unit: String(form?.validity?.unit || "days") },
        toDate: String(form.toDate || addValidity(form.fromDate || nowLocal(), form.validity)),
        payment: String(form.payment || ""),
        remarks: String(form.remarks || ""),
      };

      setBusy(true);

      if (modalMode === "add") {
        const ref = doc(collection(db, USERS_COLLECTION));
        const record = makeHistoryRecord("created", {}, payload, "created new user");
        await setDoc(ref, toFirestorePayload({ ...payload, records: [record] }));
        showToast("User added");
      } else {
        if (!editingDocId) return showToast("Invalid document ID");
        const target = users.find((u) => u.id === editingDocId);
        if (!target) return showToast("User not found");

        let nextPayload = { ...target };
        let note = "updated user";

        if (modalMode === "edit") {
          const selected = new Set(Array.isArray(form.editFields) ? form.editFields : []);
          if (!selected.size) return showToast("Select at least one field");
          EDITABLE_FIELDS.forEach((field) => {
            if (selected.has(field)) nextPayload[field] = payload[field];
          });
          note = `edited fields: ${[...selected].join(", ")}`;
        } else {
          nextPayload = { ...target, ...payload };
          note = "renewed user";
        }

        const record = makeHistoryRecord(modalMode === "renew" ? "renewed" : "edited", target, nextPayload, note);
        nextPayload.records = [record, ...(Array.isArray(target.records) ? target.records : [])];
        await setDoc(doc(db, USERS_COLLECTION, editingDocId), toFirestorePayload(nextPayload), { merge: true });
        showToast(modalMode === "renew" ? "User renewed" : "User updated");
      }

      setEditingDocId(null);
      setModalMode("add");
      resetForm();
      setUserModalOpen(false);
    } catch (e) {
      console.error("Save failed:", e);
      alert(`Save failed: ${e?.code || ""} ${e?.message || String(e)}`.trim());
    } finally {
      setBusy(false);
    }
  };

  const deleteUser = (user) => setDeleteTarget(user);

  const confirmDeleteUser = async () => {
    if (!deleteTarget) return;
    try {
      setBusy(true);
      await deleteDoc(doc(db, USERS_COLLECTION, deleteTarget.id));
      showToast("User deleted");
      setDeleteTarget(null);
    } catch (e) {
      console.error(e);
      alert(`Delete failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected users?`)) return;
    try {
      setBusy(true);
      await Promise.all([...selectedIds].map((id) => deleteDoc(doc(db, USERS_COLLECTION, id))));
      setSelectedIds(new Set());
      showToast("Selected users deleted");
    } catch (e) {
      console.error(e);
      alert(`Bulk delete failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const copyUid = async (uid) => {
    try {
      await navigator.clipboard.writeText(String(uid || ""));
      showToast("UID copied");
    } catch {
      alert("Copy failed");
    }
  };

  const exportCsv = () => {
    const csv = usersToCsv(filteredUsers);
    const date = new Date();
    downloadText(`wifi-users-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.csv`, csv, "text/csv;charset=utf-8");
    showToast("CSV exported");
  };

  const handleToggleSelected = (id, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleToggleSelectAll = (list, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      list.forEach((u) => (checked ? next.add(u.id) : next.delete(u.id)));
      return next;
    });
  };

  const handleLogin = async (email, password) => {
    try {
      setBusy(true);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (email) => {
    try {
      if (!email) return alert("Enter email");
      await sendPasswordResetEmail(auth, email);
      alert("Reset email sent");
    } catch (e) {
      alert(e.message);
    }
  };

  const currentNotice = endingSoonUsers[noticeIndex];
  const bulkCount = selectedIds.size;

  if (loadingAuth) return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">Loading...</div>;
  if (!currentUser) return <AuthScreen onLogin={handleLogin} onReset={handleReset} loading={busy} />;

  return (
    <div className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold md:text-3xl">WiFi User Management</h1>
              <p className="mt-1 text-sm text-slate-400">Firebase login + Firestore realtime sync. Signed in as {currentUser.email}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => signOut(auth)} className="rounded-2xl border border-slate-700 px-4 py-2 font-medium text-slate-100 hover:bg-slate-900">Logout</button>
              <button onClick={exportCsv} className="rounded-2xl border border-slate-700 px-4 py-2 font-medium text-slate-100 hover:bg-slate-900">Export CSV</button>
              <button onClick={openAdd} className="rounded-2xl bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-600">Add User</button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard title="Total User" value={totalUsers} />
          <StatCard title="Collected Payment" value={totalCollected.toLocaleString()} subtitle="Actual payment sum" />
          <StatCard title="Meyad Sesh User" value={expiredUsers} />
          <StatCard title="Payment Pending" value={pendingUsers} subtitle={endingSoonUsers.length ? `${currentNotice?.name || ""} | ${timeLeftLabel(currentNotice?.toDate)}` : "No ending soon user"} />
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg">
          <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200">
            {endingSoonUsers.length ? `${currentNotice?.name} | To Date: ${formatDisplay(currentNotice?.toDate)} | Remaining: ${timeLeftLabel(currentNotice?.toDate)} | Payment: ${paymentLabel(currentNotice?.payment)}` : "No user is ending soon right now."}
          </div>

          <div className="flex flex-wrap gap-2">
            <TabButton active={activeTab === "dashboard"} onClick={() => setActiveTab("dashboard")}>Main Menu</TabButton>
            <TabButton active={activeTab === "active"} onClick={() => setActiveTab("active")}>Active User</TabButton>
            <TabButton active={activeTab === "users"} onClick={() => setActiveTab("users")}>All User</TabButton>
            <TabButton active={activeTab === "expired"} onClick={() => setActiveTab("expired")}>Meyad Sesh User</TabButton>
            <TabButton active={activeTab === "pending"} onClick={() => setActiveTab("pending")}>Payment Pending</TabButton>
          </div>

          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by UID, name, date, payment, remarks, status..." className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-500 md:max-w-md" />
            <div className="flex flex-wrap gap-2">
              <select value={sortMode} onChange={(e) => setSortMode(e.target.value)} className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none">
                <option value="expiry-asc">Sort: Expiry Soon</option>
                <option value="expiry-desc">Sort: Expiry Late</option>
                <option value="name-asc">Sort: Name A-Z</option>
                <option value="name-desc">Sort: Name Z-A</option>
              </select>
              <button onClick={exportCsv} className="rounded-2xl border border-slate-700 px-4 py-3 text-sm text-slate-100 hover:bg-slate-900">Export CSV</button>
              {bulkCount > 0 ? (
                <>
                  <button onClick={handleBulkDelete} className="rounded-2xl bg-rose-500 px-4 py-3 text-sm font-medium text-white hover:bg-rose-600">Delete Selected ({bulkCount})</button>
                  <button onClick={() => setSelectedIds(new Set())} className="rounded-2xl border border-slate-700 px-4 py-3 text-sm text-slate-100 hover:bg-slate-900">Clear Selection</button>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-3 text-sm text-slate-400">Showing {activeTab === "dashboard" ? users.length : filteredUsers.length} users | Active: {activeUsers.length} | Ending soon: {endingSoonUsers.length} | Expired: {expiredList.length} | Pending: {pendingPaymentUsers.length}</div>

          <div className="mt-4">
            {busy ? <div className="mb-3 text-sm text-slate-400">Syncing data...</div> : null}
            {activeTab === "dashboard" && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
                  <h2 className="text-lg font-semibold">Recently ending users</h2>
                  <div className="mt-4 space-y-3">
                    {endingSoonUsers.length ? endingSoonUsers.slice(0, 5).map((u) => (
                      <div key={u.id} className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-medium text-white">{u.name}</div>
                            <div className="text-xs text-slate-400">To Date: {formatDisplay(u.toDate)}</div>
                            <div className="text-xs text-amber-200">Remaining: {timeLeftLabel(u.toDate)}</div>
                          </div>
                          <div className="rounded-full bg-amber-500/20 px-3 py-1 text-xs text-amber-200">{daysLeft(u.toDate, nowTick)} days left</div>
                        </div>
                      </div>
                    )) : <div className="text-sm text-slate-400">No ending-soon users found.</div>}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
                  <h2 className="text-lg font-semibold">Quick summary</h2>
                  <div className="mt-4 space-y-3 text-sm text-slate-300">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">Active users: {activeUsers.length}</div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">Ending soon users: {endingSoonUsers.length}</div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">Expired users: {expiredUsers}</div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">Payment pending users: {pendingUsers}</div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">Collected payment: {totalCollected.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "users" && <Table users={filteredUsers} nowMs={nowTick} onEdit={startEdit} onRenew={startRenew} onHistory={setHistoryUser} onDelete={deleteUser} onCopyUid={copyUid} onPrintReceipt={setReceiptUser} selectedIds={selectedIds} onToggleSelected={handleToggleSelected} onToggleSelectAll={handleToggleSelectAll} emptyText="No user found." />}
            {activeTab === "active" && <Table users={activeUsers} nowMs={nowTick} onEdit={startEdit} onRenew={startRenew} onHistory={setHistoryUser} onDelete={deleteUser} onCopyUid={copyUid} onPrintReceipt={setReceiptUser} selectedIds={selectedIds} onToggleSelected={handleToggleSelected} onToggleSelectAll={handleToggleSelectAll} emptyText="No active users found." />}
            {activeTab === "expired" && <Table users={expiredList} nowMs={nowTick} onEdit={startEdit} onRenew={startRenew} onHistory={setHistoryUser} onDelete={deleteUser} onCopyUid={copyUid} onPrintReceipt={setReceiptUser} selectedIds={selectedIds} onToggleSelected={handleToggleSelected} onToggleSelectAll={handleToggleSelectAll} emptyText="No expired users found." />}
            {activeTab === "pending" && <Table users={pendingPaymentUsers} nowMs={nowTick} onEdit={startEdit} onRenew={startRenew} onHistory={setHistoryUser} onDelete={deleteUser} onCopyUid={copyUid} onPrintReceipt={setReceiptUser} selectedIds={selectedIds} onToggleSelected={handleToggleSelected} onToggleSelectAll={handleToggleSelectAll} emptyText="No payment pending users found." />}
          </div>
        </div>
      </div>

      {userModalOpen && <UserForm title={modalMode === "add" ? "Add New User" : modalMode === "edit" ? "Edit User" : "Renew User"} form={form} setForm={setForm} onSave={saveUser} onClose={() => setUserModalOpen(false)} saveLabel={modalMode === "add" ? "Save User" : modalMode === "edit" ? "Save Edit" : "Save Renew"} mode={modalMode} />}
      {historyUser && <HistoryModal user={historyUser} onClose={() => setHistoryUser(null)} onCopy={copyUid} />}
      {receiptUser && <ReceiptModal user={receiptUser} onClose={() => setReceiptUser(null)} onPrint={printReceipt} />}
      {deleteTarget && (
        <Modal title="Delete Confirmation" onClose={() => setDeleteTarget(null)} width="max-w-md">
          <p className="mt-3 text-sm text-slate-300">Are you sure you want to delete <span className="font-semibold text-white">{deleteTarget.name}</span>?</p>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setDeleteTarget(null)} className="rounded-2xl border border-slate-700 px-4 py-2 text-slate-100 hover:bg-slate-900">Cancel</button>
            <button onClick={confirmDeleteUser} className="rounded-2xl bg-rose-500 px-4 py-2 font-medium text-white hover:bg-rose-600">Delete</button>
          </div>
        </Modal>
      )}
      <Toast toast={toast} />
    </div>
  );
}
