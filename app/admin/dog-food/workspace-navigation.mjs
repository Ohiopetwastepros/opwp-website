export const FOOD_WORKSPACES = [
  { id: 'sales', title: 'Sales operations', description: 'Orders, recorded sales and outstanding payments.', href: '/admin/dog-food/', section: 'dog-food', tabs: ['queue', 'sales', 'collections', 'funnel', 'overview'] },
  { id: 'customers', title: 'Customers', href: '/admin/dog-food/customers/', section: 'food-customers', tabs: ['customers'] },
  { id: 'record', title: 'Record a food sale', description: 'Choose a customer, record their bags and confirm payment and handoff.', href: '/admin/dog-food/record-sale/', section: 'food-sale', tabs: ['record'] },
  { id: 'inventory', title: 'Inventory & demand', description: 'Usable stock, monthly demand and purchasing.', href: '/admin/dog-food/inventory/', section: 'food-inventory', tabs: ['metrics', 'inventory', 'purchases'] },
  { id: 'profit', title: 'Sales & profit/loss', description: 'Revenue, acquisition costs and recorded margins.', href: '/admin/dog-food/profit-loss/', section: 'food-profit', tabs: ['profit'] },
  { id: 'settings', title: 'Plans & settings', description: 'Plans, fulfillment, source review and portal readiness.', href: '/admin/dog-food/settings/', section: 'food-settings', tabs: ['plans', 'website', 'sources', 'readiness', 'review'] },
];

export function foodWorkspaceForTab(tab) {
  return FOOD_WORKSPACES.find(workspace => workspace.tabs.includes(tab)) || FOOD_WORKSPACES[0];
}

export function foodWorkspaceHref(tab) {
  const workspace = foodWorkspaceForTab(tab);
  return workspace.href + (workspace.tabs[0] === tab ? '' : '?tab=' + encodeURIComponent(tab));
}
