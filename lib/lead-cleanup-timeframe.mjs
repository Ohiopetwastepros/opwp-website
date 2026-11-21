// Display the customer's timeframe independently of its conservative price band.
// Never substitute the upper bound of a range for the answer in a recap.
export function cleanupRecapClause(answer) {
  const phrase = String(answer || '').normalize('NFKC')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/(\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten))\s*-\s*(?=\d|(?:one|two|three|four|five|six|seven|eight|nine|ten)\b)/gi, '$1 to ')
    .replace(/\s+/g, ' ').replace(/\s+ago[.!?]?$/i, '').replace(/[.!?]+$/, '').trim();
  if (!phrase) return 'the cleanup timeframe still needs to be confirmed';
  if (/^(?:today|yesterday|this week|last week|on\b)/i.test(phrase)) return `the last cleanup was ${phrase}`;
  if (/^just cleaned$/i.test(phrase)) return 'the yard was just cleaned';
  if (/^since\b/i.test(phrase)) return `the yard hasn't been cleaned ${phrase}`;
  if (/^never$/i.test(phrase)) return "the yard hasn't had a thorough cleanup yet";
  const duration = /^(?:about|around|roughly|approximately|less than|within|at least|more than|over|longer than)\b/i.test(phrase) ? phrase : `about ${phrase}`;
  return `it's been ${duration} since the last cleanup`;
}
