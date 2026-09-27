"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, dollarsToCents } from "@/lib/utils";

interface TicketTier { id: string; option_value: string; price_cents: number; }
interface TicketingField { id: string; label: string; options_json: string | null; }
interface TicketingConfig {
  enabled: boolean;
  field: TicketingField | null;
  tiers: TicketTier[];
  currentOptions: string[];
  missingOptions: string[];
  orphanedTiers: TicketTier[];
}
interface DropdownField { id: string; label: string; }

export function TicketingManager({
  eventId, canManage, initialConfig, dropdownFields,
}: { eventId: string; canManage: boolean; initialConfig: TicketingConfig; dropdownFields: DropdownField[] }) {
  const router = useRouter();
  const [config, setConfig] = useState<TicketingConfig>(initialConfig);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickingField, setPickingField] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});

  async function load() {
    const res = await fetch(`/api/events/${eventId}/ticketing`);
    if (res.ok) setConfig((await res.json()).config);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const option of config.currentOptions) {
      const tier = config.tiers.find((t) => t.option_value === option);
      next[option] = tier ? (tier.price_cents / 100).toFixed(2) : "";
    }
    setPrices(next);
  }, [config.currentOptions, config.tiers]);

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

  async function linkField(fieldId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/ticketing`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldId }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Something went wrong."); return; }
    setPickingField(false);
    setSelectedFieldId("");
    await load();
    router.refresh();
  }

  async function savePrices() {
    setBusy(true);
    setError(null);
    const tiers = config.currentOptions.map((option) => ({ optionValue: option, priceCents: dollarsToCents(prices[option] || "0") }));
    const res = await fetch(`/api/events/${eventId}/ticketing/tiers`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tiers }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Something went wrong."); return; }
    await load();
    router.refresh();
  }

  async function removeOrphanedTier(tierId: string) {
    setBusy(true);
    await fetch(`/api/events/${eventId}/ticketing/tiers/${tierId}`, { method: "DELETE" });
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
          {!config.field && (
            <div className="rounded border border-brass-200 bg-brass-50 px-4 py-2.5 text-sm text-brass-600">
              {dropdownFields.length === 0
                ? "Ticketing needs a dropdown field to assign tiers from (e.g. \"Ticket Type\"). Create one under Manage fields on the Invitees page first."
                : "Choose a field to link ticket pricing to."}
            </div>
          )}

          {config.field && !pickingField && (
            <p className="text-sm text-ink-soft">
              Linked to <span className="text-ink font-medium">{config.field.label}</span>.{" "}
              {canManage && (
                <button onClick={() => { setPickingField(true); setSelectedFieldId(config.field!.id); }} className="text-wine-500 hover:underline">
                  Change linked field
                </button>
              )}
            </p>
          )}

          {canManage && (!config.field || pickingField) && dropdownFields.length > 0 && (
            <div className="flex items-end gap-2">
              <div className="flex-1 max-w-xs">
                <label className="label">Ticket tier field</label>
                <select className="input" value={selectedFieldId} onChange={(e) => setSelectedFieldId(e.target.value)}>
                  <option value="">Choose a field…</option>
                  {dropdownFields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </div>
              <button disabled={!selectedFieldId || busy} onClick={() => linkField(selectedFieldId)} className="btn-primary shrink-0">Link field</button>
              {config.field && <button onClick={() => setPickingField(false)} className="btn-ghost shrink-0">Cancel</button>}
            </div>
          )}

          {config.field && config.currentOptions.length > 0 && (
            <div>
              <p className="text-sm text-ink-soft mb-2">Set a price for each {config.field.label} option:</p>
              <div className="space-y-2 max-w-sm">
                {config.currentOptions.map((option) => {
                  const isMissing = config.missingOptions.includes(option);
                  return (
                    <div key={option} className="flex items-center gap-3">
                      <label className={`flex-1 text-sm ${isMissing ? "text-brass-600" : "text-ink"}`}>
                        {option}{isMissing && " — needs a price"}
                      </label>
                      <div className="flex items-center gap-1">
                        <span className="text-ink-faint text-sm">$</span>
                        <input
                          type="number" min="0" step="0.01" className="input w-24 py-1 text-sm"
                          value={prices[option] ?? ""}
                          onChange={(e) => setPrices((p) => ({ ...p, [option]: e.target.value }))}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {canManage && (
                <button onClick={savePrices} disabled={busy} className="btn-primary mt-3">{busy ? "Saving…" : "Save prices"}</button>
              )}
            </div>
          )}

          {config.orphanedTiers.length > 0 && (
            <div className="rounded border border-brass-200 bg-brass-50 px-4 py-2.5">
              <p className="text-sm text-brass-600 mb-2">These priced tiers no longer exist as options on the linked field:</p>
              <ul className="space-y-1.5">
                {config.orphanedTiers.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-brass-600">{t.option_value} — {formatCurrency(t.price_cents)}</span>
                    {canManage && <button onClick={() => removeOrphanedTier(t.id)} className="text-xs text-brass-600 hover:underline shrink-0">Remove this price</button>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
