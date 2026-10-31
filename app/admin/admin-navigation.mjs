// Shared destinations keep labels and active states consistent across admin pages.
export const ADMIN_NAVIGATION = [
  { id: "financials", label: "Financials", items: [
    { id: "financial-overview", label: "Financial overview", href: "/admin/financials/" },
    { id: "route-profitability", label: "Route profitability", href: "/admin/financials/routes/" },
    { id: "failed-payments", label: "Failed payments", href: "/admin/failed-payments/" },
    { id: "pricing", label: "Pricing calculator", href: "/admin/pricing-calculator/" },
  ] },
  { id: "customers", label: "Customers & growth", items: [
    { id: "customers", label: "Customers & retention", href: "/admin/?view=customers" },
    { id: "pipeline", label: "Leads", href: "/admin/quote-funnel/" },
    { id: "acquisition", label: "Acquisition", href: "/admin/acquisition/" },
  ] },
  { id: "operations", label: "Operations", items: [
    { id: "call-guide", label: "New client call guide", href: "/admin/call-guide/" },
    { id: "route-day", label: "Route Day Recommendation", href: "/admin/route-day-recommendation/" },
    { id: "operations", label: "Time gaps & follow-up", href: "/admin/operations/" },
    { id: "scorecard", label: "Management scorecard", href: "/admin/?view=scorecard" },
  ] },
  { id: "crm", label: "Routing & CRM", items: [
    { id: "planning", label: "Route planning & assignments", href: "/admin/routes/" },
    { id: "dispatch", label: "Daily dispatch · Route Partner", href: "/admin/route-partner/" },
    { id: "field-workdays", label: "Field operations & services", href: "/admin/route-partner/workdays/" },
    { id: "team", label: "Field team & access", href: "/admin/route-partner/team/" },
    { id: "office-access", label: "Office access", href: "/admin/office-access/" },
  ] },
  { id: "dog-food", label: "Dog food", items: [
    { id: "dog-food", label: "Sales operations", href: "/admin/dog-food/" },
    { id: "food-inventory", label: "Inventory & monthly demand", href: "/admin/dog-food/inventory/" },
    { id: "food-profit", label: "Sales & profit/loss", href: "/admin/dog-food/profit-loss/" },
    { id: "food", label: "Sales & retention", href: "/admin/?view=food" },
  ] },
  { id: "systems", label: "Systems & settings", items: [
    { id: "records", label: "Manage business records", href: "/admin/records/" },
    { id: "deployments", label: "Deployments", href: "/admin/deployments/" },
    { id: "system-health", label: "Integrations & health", href: "/admin/system-health/" },
    { id: "systems", label: "Data controls", href: "/admin/?view=systems" },
    { id: "events", label: "Event ledger", href: "/admin/events/" },
    { id: "security", label: "Device security", href: "/admin/security/" },
  ] },
];

export function adminGroupFor(section) {
  return ADMIN_NAVIGATION.find((group) => group.items.some((item) => item.id === section));
}
