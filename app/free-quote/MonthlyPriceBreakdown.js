export default function MonthlyPriceBreakdown({ baseMonthly, yardTier, yardUpcharge, monthlyAddons, monthlyTotal, money, compact = false }) {
  const customYard = yardTier?.id === "xlarge";
  const unsureYard = yardTier?.id === "unsure";
  const totalPending = !yardTier || customYard || monthlyTotal == null;
  const row = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "8px 12px", alignItems: "baseline" };
  const label = { margin: 0, minWidth: 0, overflowWrap: "anywhere" };
  const amount = { margin: 0, textAlign: "right", fontWeight: 700 };

  return (
    <div>
    <dl aria-label="Monthly price breakdown" style={{ margin: 0, display: "grid", gap: "10px", fontSize: "14px", lineHeight: 1.4, color: "#46545d" }}>
      <div style={row}>
        <dt style={label}>Base service</dt>
        <dd style={amount}>{baseMonthly != null ? `${money(baseMonthly)}/mo` : "To be confirmed"}</dd>
      </div>
      <div style={row}>
        <dt style={label}>
          Yard upcharge
          {yardTier && <span style={{ display: "block", fontSize: "12.5px", color: "#64717a" }}>{yardTier.label}</span>}
        </dt>
        <dd style={{ ...amount, color: "#386e2b", maxWidth: "120px" }}>
          {!yardTier ? "Select yard size" : customYard || unsureYard ? "To be confirmed" : `+${money(yardUpcharge)}/mo`}
        </dd>
      </div>
      {monthlyAddons.map((addon) => (
        <div key={addon.id} style={row}>
          <dt style={label}>{addon.name}</dt>
          <dd style={amount}>+{money(addon.price)}/mo</dd>
        </div>
      ))}
      <div style={{ ...row, borderTop: "1px solid #d5dccf", paddingTop: "12px", color: "#1A3C5A" }}>
        <dt style={{ ...label, fontWeight: 800 }}>{unsureYard ? "Estimated monthly total" : "Monthly total"}</dt>
        <dd style={{ ...amount, maxWidth: totalPending ? "130px" : undefined, fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: totalPending ? "18px" : compact ? "24px" : "32px", lineHeight: 1.15 }}>
          {totalPending ? "To be confirmed" : <>{money(monthlyTotal)}<span style={{ fontSize: "14px", fontWeight: 700 }}>/mo</span></>}
        </dd>
      </div>
    </dl>
    {(customYard || unsureYard) && <p style={{ margin: "10px 0 0", fontSize: "12.5px", color: "#64717a", lineHeight: 1.4 }}>{customYard ? "The yard upcharge and final monthly total will be confirmed for properties over 3/4 acre." : "We'll confirm your yard size and any yard upcharge at the first visit."}</p>}
    </div>
  );
}
