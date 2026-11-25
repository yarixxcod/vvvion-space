export const MAX_MODEL_PROVIDERS = 10;
export const PREMIUM_MODEL_MESSAGE = "Эта модель доступна только с подпиской VVVion Premium";
export function premiumModelAllowed(premiumOnly: boolean, premiumActive: boolean) {
  return !premiumOnly || premiumActive;
}
