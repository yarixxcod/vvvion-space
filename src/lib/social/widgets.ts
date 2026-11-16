export function widgetPayload(balance: number, cities: string[]) {
  const value = Number(balance);
  return {
    balance: Number.isFinite(value) ? value : 0,
    weatherCities: cities.filter((city) => city.trim()).map((city) => city.trim()).slice(0, 8),
  };
}
