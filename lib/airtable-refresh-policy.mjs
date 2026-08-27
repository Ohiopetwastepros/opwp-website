export async function loadAirtableTableSet(tables, loader, options = {}) {
  const data = {};
  const warnings = [];
  const optional = new Set(options.optional ?? []);
  const fallback = options.fallback ?? {};

  for (const [name, tableId] of Object.entries(tables)) {
    try {
      data[name] = await loader(name, tableId);
    } catch (error) {
      if (!optional.has(name)) throw error;
      data[name] = Array.isArray(fallback[name]) ? fallback[name] : [];
      warnings.push(`${name} retained from the prior snapshot because its Airtable table could not be read.`);
      options.onWarning?.({ name, records: data[name], error });
    }
  }

  return { data, warnings };
}
