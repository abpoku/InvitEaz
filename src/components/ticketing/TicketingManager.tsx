"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, dollarsToCents } from "@/lib/utils";

interface TicketTier { id: string; option_value: string; price_cents: number; }
interface TicketingField { id: string; label: string; }
interface TicketingConfig {
  enabled: boolean;
  field: TicketingField | null;
  tiers: TicketTier[];
}
interface DropdownField { id: string; label: string; }

export function TicketingManager({
  eventId, canManage, initialConfig, dropdownFields,
}: { eventId: string; canManage: boolean; initialConfig: TicketingConfig; dropdownFields: DropdownField[] }) {
  const router = useRouter();
  const [config, setConfig] = useState<TicketingConfig>(initialConfig);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFieldLabel, setNewFieldLabel] = useState("Ticket Type");
  const [newTierName, setNewTierName] = useState("");
  const [newTierPrice, setNewTierPrice] = useState("");
  const [showLinkExisting, setShowLinkExisting] = useState(false);
  const [existingFieldId, setExistingFieldId] = useState("");

  async function load() {
    const res = await fetch(`/api/events/${eventId}/ticketing`);
    if (res.ok) setConfig((await res.json()).config);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function toggleEnabled() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/ticketing`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !config.enabled }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Something went wrong."); return; }
    await load();
    router.refresh();
  }

  async function addTier(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newTierName.trim()) { setError("Give this tier a name."); return; }
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/ticketing/tiers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fieldId: config.field?.id,
        fieldLabel: config.field ? undefined : (newFieldLabel.trim() || "Ticket Type"),
        optionValue: newTierName.trim(),
        priceCents: dollarsToCents(newTierPrice || "0"),
      }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Something went wrong."); return; }
    setNewTierName("");
    setNewTierPrice("");
    await load();
    router.refresh();
  }

  async function saveTierPrice(tierId: string, priceStr: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/ticketing/tiers/${tierId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceCents: dollarsToCents(priceStr || "0") }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Something went wrong."); return; }
    await load();
    router.refresh();
  }

  async function removeTier(tier: TicketTier) {
    if (!confirm(`Remove the "${tier.option_value}" tier? Invitees already assigned to it will keep that value, but it'll show as unpriced.`)) return;
    setBusy(true);
    await fetch(`/api/events/${eventId}/ticketing/tiers/${tier.id}`, { method: "DELETE" });
    setBusy(false);
    await load();
    router.refresh();
  }

  async function linkExisting() {
    if (!existingFieldId) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/ticketing`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldId: existingFieldId }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Something went wrong."); return; }
    setShowLinkExisting(false);
    setExistingFieldId("");
    await load();
    router.refresh();
  }

  async function unlink() {
    if (!confirm("Unlink this field from ticketing? Its tier prices are kept, and the field becomes directly editable again.")) return;
    setBusy(true);
    await fetch(`/api/events/${eventId}/ticketing`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldId: null }),
    });
    setBusy(false);
    await load();
    router.refresh();
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl text-ink">Ticketing</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Sell priced tickets for this event — no payment processing, just tracking prices and who's paid.
          </p>
        </div>
        {canManage && (
          <label className="flex items-center gap-2 text-sm text-ink shrink-0">
            <input type="checkbox" checked={config.enabled} disabled={busy} onChange={toggleEnabled} />
            Sell tickets
          </label>
        )}
      </div>

      {error && <div className="mt-4 rounded border border-clay-500/30 bg-clay-500/5 text-clay-600 text-sm px-3 py-2.5">{error}</div>}

      {config.enabled && (
        <div className="mt-5 pt-5 border-t border-paper-line space-y-4">
          {config.field && (
            <p className="text-sm text-ink-soft">
              Linked to <span className="text-ink font-medium">{config.field.label}</span>.{" "}
              {canManage && <button onClick={unlink} className="text-wine-500 hover:underline">Unlink</button>}
            </p>
          )}

          {config.tiers.length > 0 && (
            <div className="space-y-2 max-w-sm">
              {config.tiers.map((t) => (
                <TierRow key={t.id} tier={t} canManage={canManage} busy={busy} onSave={(price) => saveTierPrice(t.id, price)} onRemove={() => removeTier(t)} />
              ))}
            </div>
          )}

          {canManage && (
            <form onSubmit={addTier} className="space-y-2 max-w-sm">
              {!config.field && (
                <div>
                  <label className="label">Tier field name</label>
                  <input className="input" value={newFieldLabel} onChange={(e) => setNewFieldLabel(e.target.value)} placeholder="Ticket Type" />
                </div>
              )}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="label">{config.field ? "Add another tier" : "First tier"}</label>
                  <input className="input" value={newTierName} onChange={(e) => setNewTierName(e.target.value)} placeholder="e.g. Adult" />
                </div>
                <div className="w-24">
                  <div className="flex items-center gap-1">
                    <span className="text-ink-faint text-sm">$</span>
                    <input type="number" min="0" step="0.01" className="input py-1 text-sm" value={newTierPrice} onChange={(e) => setNewTierPrice(e.target.value)} />
                  </div>
                </div>
                <button type="submit" disabled={busy} className="btn-primary shrink-0">Add tier</button>
              </div>
            </form>
          )}

          {canManage && !config.field && dropdownFields.length > 0 && (
            <div>
              {!showLinkExisting ? (
                <button onClick={() => setShowLinkExisting(true)} className="text-sm text-wine-500 hover:underline">
                  or link an existing dropdown field
                </button>
              ) : (
                <div className="flex items-end gap-2 max-w-sm">
                  <div className="flex-1">
                    <label className="label">Existing field</label>
                    <select className="input" value={existingFieldId} onChange={(e) => setExistingFieldId(e.target.value)}>
                      <option value="">Choose a field…</option>
                      {dropdownFields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                  </div>
                  <button disabled={!existingFieldId || busy} onClick={linkExisting} className="btn-secondary shrink-0">Link</button>
                  <button onClick={() => setShowLinkExisting(false)} className="btn-ghost shrink-0">Cancel</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TierRow({
  tier, canManage, busy, onSave, onRemove,
}: { tier: TicketTier; canManage: boolean; busy: boolean; onSave: (price: string) => void; onRemove: () => void }) {
  const [price, setPrice] = useState((tier.price_cents / 100).toFixed(2));

  return (
    <div className="flex items-center gap-3">
      <label className="flex-1 text-sm text-ink">{tier.option_value}</label>
      {canManage ? (
        <>
          <div className="flex items-center gap-1">
            <span className="text-ink-faint text-sm">$</span>
            <input
              type="number" min="0" step="0.01" className="input w-24 py-1 text-sm"
              value={price} onChange={(e) => setPrice(e.target.value)}
              onBlur={() => onSave(price)}
            />
          </div>
          <button onClick={onRemove} disabled={busy} className="text-xs text-ink-faint hover:text-clay-600 shrink-0">Remove</button>
        </>
      ) : (
        <span className="text-sm text-ink-soft">{formatCurrency(tier.price_cents)}</span>
      )}
    </div>
  );
}
