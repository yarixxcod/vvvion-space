export const SERVICE_VIEWS = ["calendar", "weather", "news", "fx", "vpn", "grab", "speed", "api"] as const;

export type ServiceView = (typeof SERVICE_VIEWS)[number];

export function serviceView(value: unknown): ServiceView | undefined {
  return typeof value === "string" && (SERVICE_VIEWS as readonly string[]).includes(value)
    ? (value as ServiceView)
    : undefined;
}
