// Юнит-хелперы для normalize-шага адаптеров (MF-406 «каркас агента-парсера»). Не полный
// словарь единиц — по одному конкретному случаю, который реально встретился у источника;
// расширяется по мере появления новых, не гадаем наперёд какие ещё понадобятся.
export function inchesToMm(inches: number): number {
  return inches * 25.4;
}

export function fahrenheitToCelsius(fahrenheit: number): number {
  return ((fahrenheit - 32) * 5) / 9;
}
