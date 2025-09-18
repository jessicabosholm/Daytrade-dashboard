import React, { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";

// Utilities
const currencyFormat = (n, currency) => {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number(n || 0));
  } catch {
    return `${currency} ${Number(n || 0).toFixed(2)}`;
  }
};
const percentFormat = (n) => `${Number(n || 0).toFixed(2)}%`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const storageKey = "trade_dashboard_data_v1";

function calcPosition({ entry, stop, balance, riskPercent, feePercent, leverage }) {
  const e = Number(entry);
  const s = Number(stop);
  const bal = Number(balance);
  const rPct = Number(riskPercent) / 100;
  const fPct = Number(feePercent) / 100;
  const lev = Math.max(1, Number(leverage || 1));
  if (!e || !s || !bal || !rPct) return null;
  const stopDist = Math.abs(e - s);
  if (stopDist <= 0) return null;
  const riskValue = bal * rPct;
  const positionUSDT = riskValue / (stopDist / e);
  const units = positionUSDT / e;
  const notional = positionUSDT;
  const marginRequired = notional / lev;
  const estFees = notional * fPct;
  return { entry: e, stop: s, stopDist, riskValue, positionUSDT, units, notional, marginRequired, estFees };
}

export default function TradeDashboard() {
  const [entries, setEntries] = useState(() => {
    const raw = localStorage.getItem(storageKey);
    if (raw) { try { return JSON.parse(raw).entries || []; } catch {} }
    return [];
  });
  const [settings, setSettings] = useState(() => {
    const raw = localStorage.getItem(storageKey);
    if (raw) { try { return JSON.parse(raw).settings || {}; } catch {} }
    return { currency: "USD", riskPercent: 1, maxDailyLossPercent: 3, dailyTargetPercent: 1, monthlyTargetPercent: 20, feePercent: 0.04, leverage: 3 };
  });
  const [form, setForm] = useState({ date: todayISO(), startBalance: "", endBalance: "", notes: "" });

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify({ entries, settings })); }, [entries, settings]);

  // Derived
  const equity = useMemo(() => {
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map((e, i) => {
      const start = Number(e.startBalance || 0);
      const end = Number(e.endBalance || 0);
      const pl = end - start;
      const retPct = start > 0 ? (pl / start) * 100 : 0;
      return { index: i + 1, date: e.date, start, end, pl, retPct };
    });
  }, [entries]);
  const accountBalance = equity.length ? equity[equity.length - 1].end : 0;
  const monthStats = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthRows = equity.filter((r) => r.date.startsWith(ym));
    const pl = monthRows.reduce((s, r) => s + r.pl, 0);
    const start = monthRows.length ? monthRows[0].start : 0;
    const retPct = start > 0 ? (pl / start) * 100 : 0;
    return { pl, retPct };
  }, [equity]);
  const dailyRow = useMemo(() => equity.find((r) => r.date === form.date), [equity, form.date]);

  const dailyLossExceeded = useMemo(() => {
    if (!dailyRow || dailyRow.start <= 0) return false;
    const lossPct = dailyRow.pl < 0 ? (Math.abs(dailyRow.pl) / dailyRow.start) * 100 : 0;
    return lossPct >= Number(settings.maxDailyLossPercent || 0);
  }, [dailyRow, settings.maxDailyLossPercent]);

  const dailyTargetHit = useMemo(() => {
    if (!dailyRow || dailyRow.start <= 0) return false;
    const ret = (dailyRow.pl / dailyRow.start) * 100;
    return ret >= Number(settings.dailyTargetPercent || 0);
  }, [dailyRow, settings.dailyTargetPercent]);

  // Handlers
  const addOrUpdateEntry = (e) => {
    e.preventDefault();
    const idx = entries.findIndex((x) => x.date === form.date);
    const payload = { date: form.date, startBalance: Number(form.startBalance || 0), endBalance: Number(form.endBalance || 0), notes: (form.notes || "").trim() };
    if (idx >= 0) {
      const copy = [...entries]; copy[idx] = payload; setEntries(copy);
    } else {
      setEntries((p) => [...p, payload]);
    }
  };
  const removeEntry = (date) => setEntries((p) => p.filter((x) => x.date !== date));

  // Position sizing
  const [ps, setPs] = useState({ entry: "", stop: "", balanceOverride: "" });
  const positionCalc = useMemo(() => {
    const bal = Number(ps.balanceOverride || accountBalance || 0);
    return calcPosition({ entry: ps.entry, stop: ps.stop, balance: bal, riskPercent: settings.riskPercent, feePercent: settings.feePercent, leverage: settings.leverage });
  }, [ps, settings, accountBalance]);

  return (
    <div className="min-h-screen w-full bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Metrics */}
        <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard title="Banca atual" value={currencyFormat(accountBalance, settings.currency)} subtitle={equity.length ? `Ultima data: ${equity[equity.length - 1].date}` : "-"} />
          <StatCard title="P/L do mes" value={currencyFormat(monthStats.pl, settings.currency)} subtitle={`Retorno: ${percentFormat(monthStats.retPct)}`} />
          <StatCard title="Meta diaria" value={percentFormat(settings.dailyTargetPercent)} subtitle={dailyRow ? `Hoje: ${percentFormat(dailyRow.retPct)}` : "-"} flag={dailyTargetHit ? "ok" : undefined} />
          <StatCard title="Perda diaria max" value={percentFormat(settings.maxDailyLossPercent)} subtitle={dailyRow ? (dailyLossExceeded ? "Limite atingido" : "Dentro do limite") : "-"} flag={dailyLossExceeded ? "warn" : undefined} />
        </section>

        {/* Daily form + Risk */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800">
            <h2 className="text-lg font-semibold mb-3">Atualizacao diaria</h2>
            <form onSubmit={addOrUpdateEntry} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <TextInput label="Data" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
                <NumberInput label="Saldo inicial" value={form.startBalance} onChange={(v) => setForm({ ...form, startBalance: v })} required />
                <NumberInput label="Saldo final" value={form.endBalance} onChange={(v) => setForm({ ...form, endBalance: v })} required />
                <TextInput label="Anotacoes (opcional)" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} placeholder="setup, emocoes, licoes..." />
              </div>
              <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 rounded-xl px-3 py-2 font-medium">Salvar</button>
            </form>
          </div>

          <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800">
            <h2 className="text-lg font-semibold mb-3">Risco e Metas</h2>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label="Risco por trade (%)" value={settings.riskPercent} onChange={(v) => setSettings((s) => ({ ...s, riskPercent: v }))} />
              <NumberInput label="Perda diaria max (%)" value={settings.maxDailyLossPercent} onChange={(v) => setSettings((s) => ({ ...s, maxDailyLossPercent: v }))} />
              <NumberInput label="Meta diaria (%)" value={settings.dailyTargetPercent} onChange={(v) => setSettings((s) => ({ ...s, dailyTargetPercent: v }))} />
              <NumberInput label="Meta mensal (%)" value={settings.monthlyTargetPercent} onChange={(v) => setSettings((s) => ({ ...s, monthlyTargetPercent: v }))} />
              <NumberInput label="Taxas ida+volta (%)" value={settings.feePercent} onChange={(v) => setSettings((s) => ({ ...s, feePercent: v }))} />
              <NumberInput label="Alavancagem" value={settings.leverage} onChange={(v) => setSettings((s) => ({ ...s, leverage: v }))} />
            </div>
            <p className="text-xs text-zinc-400 mt-3">Sugestao: risco 0.5% a 1% por trade; stop diario 2% a 3%.</p>
          </div>

          <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800">
            <h2 className="text-lg font-semibold mb-3">Calculadora de Posicao (USDT-M)</h2>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label="Entrada" value={ps.entry} onChange={(v) => setPs((s) => ({ ...s, entry: v }))} />
              <NumberInput label="Stop" value={ps.stop} onChange={(v) => setPs((s) => ({ ...s, stop: v }))} />
              <NumberInput label="Saldo p/ sizing (opcional)" value={ps.balanceOverride} onChange={(v) => setPs((s) => ({ ...s, balanceOverride: v }))} />
            </div>
            {positionCalc ? (
              <div className="mt-3 text-sm space-y-1">
                <Row label="Risco (valor)" value={currencyFormat(positionCalc.riskValue, settings.currency)} />
                <Row label="Tamanho (USDT)" value={currencyFormat(positionCalc.positionUSDT, settings.currency)} />
                <Row label="Unidades (qty)" value={Number(positionCalc.units).toFixed(6)} />
                <Row label="Margem necessaria" value={currencyFormat(positionCalc.marginRequired, settings.currency)} />
                <Row label="Taxas estimadas" value={currencyFormat(positionCalc.estFees, settings.currency)} />
                <p className="text-xs text-zinc-400 mt-2">Observacao: calculo simplificado. Verifique as regras do contrato na sua exchange.</p>
              </div>
            ) : (
              <p className="text-zinc-400 text-sm mt-2">Preencha entrada, stop e saldo para calcular.</p>
            )}
          </div>
        </section>

        {/* Equity curve */}
        <section className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Evolucao da Banca</h2>
            <span className="text-sm text-zinc-400">{equity.length} dias</span>
          </div>
          {equity.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equity} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" stroke="#a1a1aa" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <YAxis stroke="#a1a1aa" tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a", color: "#e4e4e7" }}
                    formatter={(v, n) => n === "retPct" ? [percentFormat(v), "Retorno"] : [currencyFormat(v, settings.currency), n]} />
                  <ReferenceLine y={equity[0]?.start || 0} stroke="#71717a" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="end" dot={false} stroke="#22c55e" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">Sem dados ainda. Adicione pelo menos um dia.</p>
          )}
        </section>

        {/* Table / Journal */}
        <section className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Diario de Resultados</h2>
            <button
              className="bg-zinc-800 hover:bg-zinc-700 rounded-xl px-3 py-2 text-sm"
              onClick={() => {
                const csv = [
                  ["date","startBalance","endBalance","pl","retPct","notes"].join(","),
                  ...equity.map((r) => [r.date, r.start, r.end, r.pl, r.retPct, (entries.find(e=>e.date===r.date)?.notes||"").replace(/,/g, ";")].join(","))
                ].join("\n");
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `diario_trader_${todayISO()}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >Exportar CSV</button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-400 border-b border-zinc-800">
                  <th className="py-2 pr-4">Data</th>
                  <th className="py-2 pr-4">Saldo inicial</th>
                  <th className="py-2 pr-4">Saldo final</th>
                  <th className="py-2 pr-4">P/L</th>
                  <th className="py-2 pr-4">Retorno</th>
                  <th className="py-2 pr-4">Notas</th>
                  <th className="py-2 pr-4">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {equity.map((r) => (
                  <tr key={r.date} className="border-b border-zinc-800 hover:bg-zinc-950/60">
                    <td className="py-2 pr-4">{r.date}</td>
                    <td className="py-2 pr-4">{currencyFormat(r.start, settings.currency)}</td>
                    <td className="py-2 pr-4">{currencyFormat(r.end, settings.currency)}</td>
                    <td className={`py-2 pr-4 ${r.pl>=0?"text-emerald-400":"text-rose-400"}`}>{currencyFormat(r.pl, settings.currency)}</td>
                    <td className={`py-2 pr-4 ${r.retPct>=0?"text-emerald-400":"text-rose-400"}`}>{percentFormat(r.retPct)}</td>
                    <td className="py-2 pr-4 max-w-[280px] truncate" title={entries.find(e=>e.date===r.date)?.notes || ""}>{entries.find(e=>e.date===r.date)?.notes || ""}</td>
                    <td className="py-2 pr-4">
                      <div className="flex gap-2">
                        <button className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700" onClick={() => setForm({
                          date: r.date,
                          startBalance: entries.find(e=>e.date===r.date)?.startBalance ?? r.start,
                          endBalance: entries.find(e=>e.date===r.date)?.endBalance ?? r.end,
                          notes: entries.find(e=>e.date===r.date)?.notes || "",
                        })}>Editar</button>
                        <button className="px-2 py-1 rounded-lg bg-rose-700 hover:bg-rose-600" onClick={() => removeEntry(r.date)}>Excluir</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Checklist */}
        <section className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800">
          <h2 className="text-lg font-semibold mb-3">Regras de Parada e Checklist</h2>
          <ul className="list-disc pl-5 space-y-2 text-sm text-zinc-300">
            <li>Se atingir {percentFormat(settings.maxDailyLossPercent)} de perda no dia, encerrar operacoes.</li>
            <li>Se atingir a meta diaria de {percentFormat(settings.dailyTargetPercent)}, considerar parar e preservar ganhos.</li>
            <li>Operar somente setups validados e com stop tecnico claro.</li>
            <li>Evitar overtrade e operar apenas no horario com vantagem estatistica.</li>
            <li>Anotar licoes diarias (tecnica e emocional) no Diario.</li>
          </ul>
        </section>

        <footer className="text-xs text-zinc-500 pb-8">
          Feito para organizar banca, metas e risco. Seus dados ficam no seu navegador (localStorage).
        </footer>
      </div>
    </div>
  );
}

// Small UI helpers
function StatCard({ title, value, subtitle, flag }) {
  const base = "rounded-2xl p-4 border";
  const cls = flag === "warn"
    ? `${base} border-rose-700 bg-rose-900/10`
    : flag === "ok"
      ? `${base} border-emerald-700 bg-emerald-900/10`
      : `${base} border-zinc-800 bg-zinc-900`;
  return (
    <div className={cls}>
      <div className="text-sm text-zinc-400">{title}</div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{subtitle}</div>
    </div>
  );
}
function NumberInput({ label, value, onChange, required }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-zinc-400">{label}</label>
      <input type="number" step="0.01" className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2" value={value} onChange={(e) => onChange(e.target.value)} required={required} />
    </div>
  );
}
function TextInput({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-zinc-400">{label}</label>
      <input type={type} className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
