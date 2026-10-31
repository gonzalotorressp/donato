export function discountedPolicyPrice(listNet: number, discount: number, vat: number | null) {
  if (!Number.isFinite(listNet) || listNet < 0 || !Number.isFinite(discount) || discount < 0 || discount > 100) return null;
  const net = listNet * (1 - discount / 100);
  const round = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;
  return {
    net: round(net),
    gross: vat == null || !Number.isFinite(vat) || vat < 0 ? null : round(net * (1 + vat / 100)),
  };
}
