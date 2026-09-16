export const DEFAULT_FRONTEND_RETURN_PATH = "/discover";

export const PRODUCTION_FRONTEND_URL = "https://tribel.in/discover";
export const DEVELOPMENT_FRONTEND_URL = "http://localhost:3001/discover";

export function resolveFrontendUrl(
  nodeEnv: string | undefined,
  raw: string | undefined,
): string {
  if (raw) return raw;

  return nodeEnv === "production"
    ? PRODUCTION_FRONTEND_URL
    : DEVELOPMENT_FRONTEND_URL;
}

const CONTROL_CHARACTERS = [
  ...Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(i)),
  ...Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(0x7f + i)),
];

function hasControlCharacter(value: string): boolean {
  return CONTROL_CHARACTERS.some((char) => value.includes(char));
}

export function isSafeRelativePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasControlCharacter(value)
  ) {
    return false;
  }

  try {
    return (
      new URL(value, "https://relative.invalid").origin ===
      "https://relative.invalid"
    );
  } catch {
    return false;
  }
}

export function getSafeReturnPath(value: unknown): string {
  return isSafeRelativePath(value) ? value : DEFAULT_FRONTEND_RETURN_PATH;
}

export function buildFrontendRedirect(
  frontendOrigin: string,
  returnPath: string,
): string {
  const safePath = getSafeReturnPath(returnPath);
  return new URL(safePath, frontendOrigin).toString();
}

export function normalizeFrontendOrigin(raw: string): string {
  const withProtocol = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  return url.origin;
}
