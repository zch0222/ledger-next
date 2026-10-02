/** Business date (YYYY-MM-DD) of an instant in an IANA timezone; reports and filters use it, not the UTC date. */
export function localDate(at: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
