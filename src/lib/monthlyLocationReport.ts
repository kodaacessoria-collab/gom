export interface MonthlyReportPoint {
  id: string;
  operationId: string;
  name: string;
  address: string;
  neighborhood: string;
}

export interface MonthlyReportOrder {
  id: string;
  operationId: string;
  category: string;
  deliveryDate: string;
  deliveries: {
    id: string;
    deliveryPointId: string;
    items: { product: string; unit: string; quantity: number }[];
  }[];
}

export interface MonthlyLocationGroup {
  id: string;
  name: string;
  address: string;
  rows: { category: string; product: string; unit: string; quantity: number }[];
  orderCount: number;
  deliveryCount: number;
}

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();

export function getReportMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const year = Number(month.slice(0, 4));
  if (year < 1000) return null;
  const index = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const names = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return { start: `${month}-01`, end: `${month}-${lastDay}`, label: `${names[index - 1]}/${year}`, days: lastDay };
}

/** Consolida o mês inteiro pela data de entrega, incluindo pedidos cadastrados só com mês/ano. */
export function buildMonthlyLocationReport(
  orders: MonthlyReportOrder[], points: MonthlyReportPoint[], operationId: string,
  month: string, category = 'Todas', selectedIds: string[] | null = null,
): MonthlyLocationGroup[] {
  const period = getReportMonth(month);
  if (!period) return [];
  const selected = selectedIds === null ? null : new Set(selectedIds);
  const pointsById = new Map(points.filter(point => point.operationId === operationId).map(point => [point.id, point]));
  const groups = new Map<string, {
    point: MonthlyReportPoint | undefined;
    rows: Map<string, MonthlyLocationGroup['rows'][number]>;
    orders: Set<string>;
    deliveries: Set<string>;
  }>();
  for (const order of orders) {
    if (order.operationId !== operationId || (category !== 'Todas' && normalize(order.category) !== normalize(category))) continue;
    const date = order.deliveryDate;
    if (date !== month && !(new RegExp(`^${month}-\\d{2}$`).test(date) && date >= period.start && date <= period.end)) continue;
    for (const delivery of order.deliveries) {
      if (!delivery.deliveryPointId || (selected && !selected.has(delivery.deliveryPointId))) continue;
      for (const item of delivery.items) {
        const quantity = Number(item.quantity);
        if (!item.product.trim() || !Number.isFinite(quantity) || quantity <= 0) continue;
        let group = groups.get(delivery.deliveryPointId);
        if (!group) {
          group = { point: pointsById.get(delivery.deliveryPointId), rows: new Map(), orders: new Set(), deliveries: new Set() };
          groups.set(delivery.deliveryPointId, group);
        }
        const unit = normalize(item.unit || 'UN');
        const key = JSON.stringify([normalize(order.category), normalize(item.product), unit]);
        const row = group.rows.get(key);
        if (row) row.quantity += quantity;
        else group.rows.set(key, { category: order.category, product: item.product.trim(), unit, quantity });
        group.orders.add(order.id);
        group.deliveries.add(JSON.stringify([order.id, delivery.id]));
      }
    }
  }
  return [...groups].map(([id, group]) => ({
    id, name: group.point?.name || `Local não cadastrado (${id})`,
    address: [group.point?.address, group.point?.neighborhood].filter(Boolean).join(' - '),
    rows: [...group.rows.values()].sort((a, b) => a.category.localeCompare(b.category, 'pt-BR') || a.product.localeCompare(b.product, 'pt-BR') || a.unit.localeCompare(b.unit)),
    orderCount: group.orders.size, deliveryCount: group.deliveries.size,
  })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }) || a.id.localeCompare(b.id));
}
