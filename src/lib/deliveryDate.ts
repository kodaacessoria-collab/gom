// A month-only delivery is stored as YYYY-MM, without inventing a delivery day.
export const isDeliveryMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export const parseDeliveryDate = (value: string): string => {
  const text = value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const monthIso = text.match(/^(\d{4})[-/](\d{1,2})$/);
  const monthBr = text.match(/^(\d{1,2})[/-](\d{4})$/);
  const names = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const named = text.match(/^([a-z]+)\.?\s*(?:\/|-|de|\s)\s*(\d{4})$/);
  const namedIndex = named ? names.findIndex(name => named[1] === name || named[1] === name.slice(0, 3)) : -1;
  const year = monthIso?.[1] || monthBr?.[2] || (namedIndex >= 0 ? named?.[2] : undefined);
  const month = monthIso?.[2] || monthBr?.[1] || (namedIndex >= 0 ? String(namedIndex + 1) : undefined);
  if (year && month) {
    const result = `${year}-${month.padStart(2, '0')}`;
    return isDeliveryMonth(result) ? result : '';
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/i);
  const br = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!iso && !br) return '';
  const y = Number(iso?.[1] || br?.[3]);
  const m = Number(iso?.[2] || br?.[2]);
  const d = Number(iso?.[3] || br?.[1]);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
};

export const deliveryDateInRange = (value: string, start: string, end: string) => {
  const first = isDeliveryMonth(value) ? `${value}-01` : value;
  const last = isDeliveryMonth(value)
    ? `${value}-${new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 0).getDate()}` : value;
  return (!start || last >= start) && (!end || first <= end);
};
